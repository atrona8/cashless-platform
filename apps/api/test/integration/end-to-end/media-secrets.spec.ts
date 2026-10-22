// Bout en bout : aucun secret des bracelets en clair au repos (mission bracelets-nfc, WP20, T083
// ; NFR-002, SC-004). Le test déroule lui-même un parcours qui produit tous les secrets de la
// mission :
//   - personnalisation par la route (processus `personalization`) : identité de puce, PWD‖PACK ;
//   - fichier de commande des codes imprimés (`issueClaimCodeOrder`) : codes en clair une fois ;
//   - association du code imprimé au bracelet (poste de personnalisation) ;
//   - rotation de la clé de données par les travailleurs (personnalisation puis clés de
//     bracelet) ;
//   - demande de mot de passe par un terminal (processus `tag-keys`) ;
//   - rattachement par code d'un bracelet approvisionné : demande en attente (202) et code de
//     confirmation à 6 chiffres ;
//   - un passage du contrôle quotidien (processus `tag-check`), qui recalcule et déchiffre les
//     mots de passe stockés ;
//   - quelques refus (mauvais code, mauvais corps). Puis il cherche chaque valeur, sous ses
//     formes hexadécimale (deux casses), base64, base64url et texte, dans toutes les colonnes
//     texte, JSON et binaires de toutes les tables (liste GÉNÉRÉE depuis pg_catalog, jamais
//     écrite à la main), dans les journaux capturés et dans les réponses d'erreur. Contrôle du
//     contrôle : les mêmes valeurs écrites volontairement en clair dans une table créée pour
//     l'occasion et dans une ligne d'audit, dans une transaction annulée, DOIVENT être trouvées.
import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { FakeKms } from '../../../src/kms/fake-kms';
import { DailyCheckWorker } from '../../../src/media/daily-check/daily-check.worker';
import { DekWorker } from '../../../src/media/keys/dek.worker';
import { ReencryptWorker } from '../../../src/media/keys/reencrypt.worker';
import { createKeyProcess, createTestApp, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { plantApprovedKeyJob } from '../../support/key-jobs';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  activateMedia,
  createBatch,
  createChip,
  createMediaWorld,
  createStation,
  creditWallet,
  expectedPwdPack,
  goLive,
  MEDIA_KEY_INDEX,
  ownerRows as rows,
  personalizationBody,
  type MediaWorld,
} from '../../support/media-fixtures';

// ----- Secrets recherchés et leurs formes -----

type SecretKind = 'identity' | 'pwd-pack' | 'data-key' | 'claim-code' | 'confirmation-code';

interface Secret {
  kind: SecretKind;
  /** Octets (identité, mot de passe, clé de données) ou texte (codes). */
  value: Buffer | string;
}

/** Formes d'une valeur : motifs insensibles à la casse, sensibles à la casse, et octets bruts. */
interface Forms {
  insensitive: string[];
  sensitive: string[];
  bytes: Buffer[];
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

function formsOf(secret: Secret): Forms {
  if (Buffer.isBuffer(secret.value)) {
    const bytes = secret.value;
    const hex = bytes.toString('hex');
    const base64 = bytes.toString('base64').replace(/=+$/, '');
    const base64url = bytes.toString('base64url');
    return {
      // L'hexadécimal, insensible à la casse, couvre minuscules et majuscules.
      insensitive: [escapeRegex(hex)],
      // Le base64 distingue les casses : une recherche insensible le diluerait.
      sensitive: [...new Set([base64, base64url])].map(escapeRegex),
      // Octets bruts, et chaque forme texte écrite comme octets (colonnes bytea).
      bytes: [
        bytes,
        ...[hex, hex.toUpperCase(), base64, base64url].map((t) => Buffer.from(t, 'utf8')),
      ],
    };
  }
  const text = secret.value;
  if (secret.kind === 'claim-code') {
    // Code imprimé : avec ou sans tiret, quelle que soit la casse.
    return {
      insensitive: [`${escapeRegex(text.slice(0, 4))}-?${escapeRegex(text.slice(4))}`],
      sensitive: [],
      bytes: [text, `${text.slice(0, 4)}-${text.slice(4)}`, text.toLowerCase()].map((t) =>
        Buffer.from(t, 'utf8'),
      ),
    };
  }
  // Code de confirmation (6 chiffres) : borné, pour ne pas le confondre avec une suite de
  // chiffres d'un identifiant, d'un horodatage (microsecondes après « . ») ou d'un numéro plus
  // long.
  return {
    insensitive: [`(^|[^0-9A-Za-z.:+-])${text}([^0-9A-Za-z]|$)`],
    sensitive: [],
    bytes: [],
  };
}

function needlesOf(secrets: Secret[]): Forms {
  const all = secrets.map(formsOf);
  return {
    insensitive: all.flatMap((f) => f.insensitive),
    sensitive: all.flatMap((f) => f.sensitive),
    bytes: all.flatMap((f) => f.bytes),
  };
}

/** Secrets trouvés dans un texte (journaux, réponse) : rend leurs genres. */
function secretsInText(text: string, secrets: Secret[]): string[] {
  const found: string[] = [];
  for (const secret of secrets) {
    const forms = formsOf(secret);
    const hit =
      forms.insensitive.some((p) => new RegExp(p, 'i').test(text)) ||
      forms.sensitive.some((p) => new RegExp(p).test(text));
    if (hit) found.push(secret.kind);
  }
  return found;
}

// ----- Recherche dans la base, générée depuis le catalogue -----

interface ScannedColumn {
  schema: string;
  table: string;
  column: string;
  mode: 'bytes' | 'text';
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Toutes les colonnes texte (catégorie S : text, varchar, char, citext…), json, jsonb, bytea, et
 * tableaux de ces types (y compris par un domaine), de toutes les tables ordinaires des schémas
 * de l'application (tout sauf pg_catalog, information_schema, pg_toast et les schémas
 * temporaires).
 */
async function catalogColumns(db: Client): Promise<ScannedColumn[]> {
  const { rows: columns } = await db.query<ScannedColumn>(
    `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
            CASE WHEN b.typname = 'bytea' THEN 'bytes' ELSE 'text' END AS mode
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       JOIN pg_type b ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
       LEFT JOIN pg_type e ON e.oid = b.typelem AND b.typcategory = 'A'
      WHERE c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%'
        AND (b.typcategory = 'S' OR b.typname IN ('json', 'jsonb', 'bytea')
             OR (b.typcategory = 'A'
                 AND (e.typcategory = 'S' OR e.typname IN ('json', 'jsonb', 'bytea'))))
      ORDER BY n.nspname, c.relname, a.attnum`,
  );
  return columns;
}

/** Colonnes où l'une des valeurs apparaît, sous la forme « schéma.table.colonne (n lignes) ». */
async function scanDatabase(db: Client, secrets: Secret[]): Promise<string[]> {
  const needles = needlesOf(secrets);
  const insensitive = needles.insensitive.join('|');
  // Un motif vide trouverait tout : sans motif sensible, une valeur qui n'existe nulle part.
  const sensitive = needles.sensitive.length
    ? needles.sensitive.join('|')
    : `x${randomUUID()}-jamais`;
  const byTable = new Map<string, ScannedColumn[]>();
  for (const column of await catalogColumns(db)) {
    const table = `${ident(column.schema)}.${ident(column.table)}`;
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  const hits: string[] = [];
  for (const [table, columns] of byTable) {
    const expressions = columns.map((column) =>
      column.mode === 'bytes'
        ? `EXISTS (SELECT 1 FROM unnest(p.b) AS s(v)
                   WHERE position(s.v IN t.${ident(column.column)}) > 0)`
        : // Un tableau de bytea passe en texte sous la forme \x… : l'hexadécimal le couvre.
          `(t.${ident(column.column)}::text ~* p.i OR t.${ident(column.column)}::text ~ p.s)`,
    );
    const counts = expressions.map((e, i) => `count(*) FILTER (WHERE ${e})::int AS c${i}`);
    const { rows: result } = await db.query<Record<string, number>>(
      // Les trois paramètres sont toujours déclarés, quels que soient les types des
      // colonnes.
      `WITH p AS (SELECT $1::text AS i, $2::text AS s, $3::bytea[] AS b)
       SELECT ${counts.join(', ')} FROM ONLY ${table} AS t, p`,
      [insensitive, sensitive, needles.bytes],
    );
    columns.forEach((column, i) => {
      const n = result[0]![`c${i}`]!;
      if (n > 0) hits.push(`${column.schema}.${column.table}.${column.column} (${n})`);
    });
  }
  return hits;
}

/** Lecture seule, en propriétaire, dans une transaction READ ONLY annulée. */
const scanReadOnly = (secrets: Secret[]) =>
  withOwner(async (db) => {
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
      return await scanDatabase(db, secrets);
    } finally {
      await db.query('ROLLBACK');
    }
  });

// ----- Parcours -----

describe('aucun secret des bracelets en clair au repos (NFR-002, SC-004)', () => {
  let w: MediaWorld;
  let api: INestApplication;
  let perso: KeyProcessApp;
  let tagKeys: KeyProcessApp;
  let tagCheck: KeyProcessApp;
  let device: TestDevice;
  let batchId: string;
  const secrets: Secret[] = [];
  const add = (kind: SecretKind, value: Buffer | string) => {
    const key = Buffer.isBuffer(value) ? value.toString('hex') : value;
    if (
      !secrets.some((s) => (Buffer.isBuffer(s.value) ? s.value.toString('hex') : s.value) === key)
    )
      secrets.push({ kind, value: Buffer.isBuffer(value) ? Buffer.from(value) : value });
  };
  const of = (kind: SecretKind) => secrets.filter((s) => s.kind === kind);
  /** Réponses d'erreur reçues pendant le parcours (statut, en-têtes, corps). */
  const errors: { what: string; status: number; text: string }[] = [];
  let logged = '';

  const personalizationPath = () => `/v1/operators/${w.ops.a}/media-personalizations`;
  const persoPost = (path: string, body: object) =>
    request(perso.app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${w.personalizerA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const claim = (who: TestCustomer, body: object) =>
    request(api.getHttpServer())
      .post('/v1/me/media')
      .set(who.headers)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const keepError = (what: string, res: request.Response) => {
    errors.push({
      what,
      status: res.status,
      text: `${JSON.stringify(res.headers)}\n${res.text ?? ''}`,
    });
  };
  /** Clés de données du prestataire A, en clair, rouvertes par le faux service de clés. */
  const collectDataKeys = async () => {
    const stored = await rows<{ wrapping_kms_key_ref: string; encrypted_dek: Buffer | null }>(
      `SELECT wrapping_kms_key_ref, encrypted_dek FROM tag_data_key WHERE operator_id = $1`,
      [w.ops.a],
    );
    const kms = new FakeKms();
    for (const key of stored) {
      if (key.encrypted_dek)
        add('data-key', await kms.decrypt(key.wrapping_kms_key_ref, key.encrypted_dek));
    }
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      batchId = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        kind: 'PUBLIC',
        quantity: 3,
      });
    });
    api = await createTestApp({ identity: w.idp });
    perso = await createKeyProcess('personalization', { identity: w.idp });
    tagKeys = await createKeyProcess('tag-keys');
    tagCheck = await createKeyProcess('tag-check');

    // Tout ce que les processus écrivent pendant le parcours est gardé (les appels passent
    // quand même à la sortie réelle).
    const spies = [
      jest.spyOn(process.stdout, 'write'),
      jest.spyOn(process.stderr, 'write'),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m)),
    ];
    try {
      // 1. Fichier de commande des codes imprimés : seul moment où ils existent en clair.
      const order = await request(api.getHttpServer())
        .post(`/v1/operators/${w.ops.a}/media-batches/${batchId}/claim-code-order`)
        .set('Authorization', `Bearer ${w.organizerAdminA.token}`)
        .set('Idempotency-Key', randomUUID())
        .send();
      expect(order.status).toBe(200);
      const lines = order.text.trimEnd().split('\n');
      expect(lines[0]).toBe('rank,code,url');
      for (const line of lines.slice(1)) add('claim-code', line.split(',')[1]!.replace('-', ''));
      expect(of('claim-code')).toHaveLength(3);
      const codes = of('claim-code').map((s) => s.value as string);

      // 2. Personnalisation de deux bracelets par la route.
      const media: { id: string; uid: string }[] = [];
      for (let i = 0; i < 2; i += 1) {
        const chip = createChip();
        const station = createStation();
        add('identity', chip.identity);
        const res = await persoPost(
          personalizationPath(),
          personalizationBody(batchId, chip, station),
        );
        expect(res.status).toBe(201);
        const pwdPack = station.open(res.body.pwd_pack, res.body.media_id, chip.uid);
        const expected = await expectedPwdPack(w.keyRef.a, w.ops.a, MEDIA_KEY_INDEX, chip.uid);
        expect(pwdPack.equals(expected)).toBe(true);
        add('pwd-pack', pwdPack);
        media.push({ id: res.body.media_id, uid: chip.uid });
      }
      await collectDataKeys();
      expect(of('data-key').length).toBeGreaterThanOrEqual(1);

      // 3. Association des codes imprimés aux bracelets, au poste.
      for (let i = 0; i < 2; i += 1) {
        const res = await persoPost(`${personalizationPath()}/${media[i]!.id}/claim-code`, {
          claim_code: codes[i],
        });
        expect(res.status).toBe(204);
      }

      // 4. Rotation de la clé de données : ouverte par la personnalisation, rechiffrement
      // par le processus des clés de bracelet.
      // Travail inscrit comme l'API à l'approbation d'une demande à deux (sinon refusé : SEC-1).
      await withOwner((db) =>
        plantApprovedKeyJob(db, {
          operatorId: w.ops.a,
          keyIndex: MEDIA_KEY_INDEX,
          kind: 'ROTATE_DEK',
          requestedBy: w.operatorAdminA.userId,
          approvedBy: w.organizerAdminA.userId,
        }),
      );
      expect(await perso.app.get(DekWorker, { strict: false }).runOnce([w.ops.a, w.ops.b])).toBe(1);
      await collectDataKeys();
      expect(
        await tagKeys.app.get(ReencryptWorker, { strict: false }).runOnce([w.ops.a, w.ops.b]),
      ).toBe(1);
      await collectDataKeys();
      expect(of('data-key').length).toBeGreaterThanOrEqual(2);

      // 5. Demande de mot de passe par un terminal.
      const authKey = await request(tagKeys.app.getHttpServer())
        .post('/v1/media/auth-keys')
        .set(device.headers)
        .send({ nfc_uid: media[0]!.uid, key_index: MEDIA_KEY_INDEX });
      expect(authKey.status).toBe(200);
      const opened = device.open(authKey.body.enc, Buffer.from(media[0]!.uid, 'hex'));
      expect(opened.equals(of('pwd-pack')[0]!.value as Buffer)).toBe(true);

      // 6. Bracelet approvisionné : actif, portefeuille anonyme crédité ; deux
      // festivaliers le demandent par son code → deux demandes en attente, deux codes de
      // confirmation.
      await withOwner(async (db) => {
        // Passages permis d'un lot (media_batch_transition) : ORDERED → PERSONALIZED →
        // DELIVERED → ACTIVE.
        for (const status of ['PERSONALIZED', 'DELIVERED', 'ACTIVE']) {
          await db.query('UPDATE media_batch SET status = $2 WHERE id = $1 AND status <> $2', [
            batchId,
            status,
          ]);
        }
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        const walletId = (
          await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
        ).rows[0]!.id;
        await activateMedia(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          walletId,
          mediaIds: [media[0]!.id],
        });
        await creditWallet(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          walletId,
          amount: 3000,
        });
      });
      const customers = await withOwner(async (db) => [
        await createTestCustomer(db, w.ops.a),
        await createTestCustomer(db, w.ops.a),
        await createTestCustomer(db, w.ops.a),
      ]);
      for (const who of customers.slice(0, 2)) {
        const res = await claim(who, { claim_code: codes[0] });
        expect(res.status).toBe(202);
        expect(res.body.confirmation_code).toMatch(/^\d{6}$/);
        add('confirmation-code', res.body.confirmation_code);
      }
      const confirmations = of('confirmation-code').map((s) => s.value as string);

      // 6 bis. Contrôle quotidien du prestataire : recalcul et déchiffrement des mots de passe
      // stockés, compte rendu et journaux du processus `tag-check` capturés comme les autres.
      const checkWorker = tagCheck.app.get(DailyCheckWorker, { strict: false });
      expect(await checkWorker.runOnce([w.ops.a])).toBe(1);
      const checkRuns = await rows<{ status: string; sampled: number }>(
        'SELECT status, sampled FROM tag_key_check_run WHERE operator_id = $1',
        [w.ops.a],
      );
      expect(checkRuns).toEqual([{ status: 'OK', sampled: expect.any(Number) }]);
      expect(checkRuns[0]!.sampled).toBeGreaterThan(0);

      // 7. Refus : mauvais code, mauvais corps — chacun porte des secrets dans la demande.
      const stranger = customers[2]!;
      keepError('code imprimé non associé', await claim(stranger, { claim_code: codes[2] }));
      keepError('code imprimé mal formé', await claim(stranger, { claim_code: `${codes[1]}Z` }));
      keepError(
        'corps mal formé (rattachement)',
        await claim(stranger, { claim_code: 42, confirmation_code: confirmations[0] }),
      );
      keepError(
        'code déjà associé à un autre bracelet',
        await persoPost(`${personalizationPath()}/${media[1]!.id}/claim-code`, {
          claim_code: codes[0],
        }),
      );
      const chip = createChip();
      add('identity', chip.identity);
      keepError(
        'identité en clair à la place de son empreinte',
        await persoPost(
          personalizationPath(),
          personalizationBody(batchId, chip, createStation(), {
            token_hash: chip.identity.toString('hex'),
          }),
        ),
      );
      keepError(
        'demande de mot de passe mal formée',
        await request(tagKeys.app.getHttpServer())
          .post('/v1/media/auth-keys')
          .set(device.headers)
          .send({
            nfc_uid: media[0]!.uid,
            key_index: 'x',
            pwd: (of('pwd-pack')[0]!.value as Buffer).toString('hex'),
          }),
      );
      const wrongDigits = String((Number(confirmations[0]) + 1) % 1_000_000).padStart(6, '0');
      keepError(
        'confirmation au guichet sur une lecture inconnue',
        await request(api.getHttpServer())
          .post('/v1/media/claims/confirmations')
          .set(device.headers)
          .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ tap_id: 2_000_000_000, claim_code: codes[0], confirmation_code: wrongDigits }),
      );
    } finally {
      logged = spies
        .flatMap((spy) =>
          (spy.mock.calls as unknown[][]).map((call) =>
            typeof call[0] === 'string' || Buffer.isBuffer(call[0])
              ? String(call[0])
              : format(...call),
          ),
        )
        .join('\n');
      spies.forEach((spy) => spy.mockRestore());
    }
  }, 120_000);

  afterAll(async () => {
    await tagCheck?.app.close();
    await tagKeys?.app.close();
    await perso?.app.close();
    await api?.close();
  });

  it('le parcours a bien produit chaque genre de secret', () => {
    const kinds: SecretKind[] = [
      'identity',
      'pwd-pack',
      'data-key',
      'claim-code',
      'confirmation-code',
    ];
    for (const kind of kinds) expect(of(kind).length).toBeGreaterThan(0);
    for (const s of of('identity')) expect(s.value).toHaveLength(16);
    for (const s of of('pwd-pack')) expect(s.value).toHaveLength(6);
    for (const s of of('data-key')) expect(s.value).toHaveLength(32);
  });

  it('la liste des colonnes vient du catalogue et couvre les tables sensibles', async () => {
    const columns = await withOwner(catalogColumns);
    const names = new Set(columns.map((c) => `${c.table}.${c.column}`));
    for (const name of [
      'audit_log.before',
      'audit_log.after',
      'api_idempotency.response_body',
      'api_idempotency.response_headers',
      'media.pwd_pack_enc',
      'tag_data_key.encrypted_dek',
      'claim_code.code_hash',
      'media_claim.confirmation_hash',
      'tag_key_job.payload',
    ])
      expect(names).toContain(name);
  });

  it('aucune valeur secrète dans la base, sous aucune forme', async () => {
    expect(await scanReadOnly(secrets)).toEqual([]);
  }, 300_000);

  it('aucune valeur secrète dans les journaux capturés', () => {
    expect(secretsInText(logged, secrets)).toEqual([]);
  });

  it('aucune réponse d’erreur ne contient de valeur secrète', () => {
    expect(errors).toHaveLength(7);
    for (const error of errors) {
      expect({ what: error.what, client: error.status >= 400 && error.status < 500 }).toEqual({
        what: error.what,
        client: true,
      });
      expect({ what: error.what, found: secretsInText(error.text, secrets) }).toEqual({
        what: error.what,
        found: [],
      });
    }
  });

  it('contrôle du contrôle : un secret écrit en clair est trouvé, puis annulé', async () => {
    const identity = of('identity')[0]!.value as Buffer;
    const pwdPack = of('pwd-pack')[0]!.value as Buffer;
    const dataKey = of('data-key')[0]!.value as Buffer;
    const code = of('claim-code')[0]!.value as string;
    const digits = of('confirmation-code')[0]!.value as string;
    const probe = 'zz_media_secrets_probe';
    const found = await withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        // Table créée dans la transaction : la recherche, générée depuis le catalogue,
        // doit la voir.
        await db.query(
          `CREATE TABLE public.${probe} (
             raw bytea, hex_bytes bytea, code text, b64 varchar(200), conf jsonb, codes text[],
             clean text)`,
        );
        await db.query(
          `INSERT INTO public.${probe} (raw, hex_bytes, code, b64, conf, codes, clean)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            dataKey,
            Buffer.from(identity.toString('hex'), 'utf8'),
            `code ${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()} imprimé`,
            `clé ${dataKey.toString('base64')}`,
            JSON.stringify({ confirmation_code: digits }),
            [`x${pwdPack.toString('hex')}`],
            'rien de secret ici',
          ],
        );
        // Une ligne d'audit et une colonne d'une table existante.
        await db.query(`INSERT INTO audit_log (operator_id, action, after) VALUES ($1, $2, $3)`, [
          w.ops.a,
          'TEST_SECRET_PROBE',
          JSON.stringify({ leak: identity.toString('base64url') }),
        ]);
        await db.query(
          `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, $3)`,
          [randomUUID(), w.ops.a, `fuite ${pwdPack.toString('hex').toUpperCase()}`],
        );
        return await scanDatabase(db, secrets);
      } finally {
        await db.query('ROLLBACK');
      }
    });
    const columns = found.map((hit) => hit.replace(/ \(\d+\)$/, ''));
    for (const column of ['raw', 'hex_bytes', 'code', 'b64', 'conf', 'codes'])
      expect(columns).toContain(`public.${probe}.${column}`);
    expect(columns).toContain('public.audit_log.after');
    expect(columns).toContain('public.party.legal_name');
    expect(columns).not.toContain(`public.${probe}.clean`);
    // Chaque forme isolée est trouvée aussi par la recherche dans un texte (journaux,
    // réponses).
    expect(secretsInText(identity.toString('hex').toUpperCase(), secrets)).toEqual(['identity']);
    expect(secretsInText(`"${pwdPack.toString('base64')}"`, secrets)).toEqual(['pwd-pack']);
    expect(secretsInText(dataKey.toString('base64url'), secrets)).toEqual(['data-key']);
    expect(secretsInText(`${code.slice(0, 4)}-${code.slice(4)}`, secrets)).toEqual(['claim-code']);
    expect(secretsInText(`{"confirmation_code":"${digits}"}`, secrets)).toEqual([
      'confirmation-code',
    ]);
    // Rien n'est resté : la table et les lignes plantées ont disparu avec la transaction.
    expect(await rows(`SELECT to_regclass('public.${probe}') AS t`)).toEqual([{ t: null }]);
    expect(
      await rows(`SELECT 1 FROM audit_log WHERE operator_id = $1 AND action = $2`, [
        w.ops.a,
        'TEST_SECRET_PROBE',
      ]),
    ).toEqual([]);
  }, 300_000);
});
