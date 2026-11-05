// Aucun secret de la mission hors ligne en clair au repos, en journal, en réponse ni en environnement
// (lot WP21, T088 ; SC-007, NFR-008 ; modèles `media-secrets.spec.ts` et `topup-secrets.spec.ts`).
// Le test déroule lui-même un parcours qui produit tous les secrets :
//   - mots de passe de bracelet (PWD||PACK) : bracelets personnalisés, chiffrés sous leur clé de données ;
//   - clé de contenu `K_v` en clair : FULL construit par le vrai travailleur `snapshot-content`, clé
//     enveloppée pour les terminaux par le vrai travailleur d'enveloppes ;
//   - clé privée de signature du faux service de clés : brouillon vérifié, signé et publié par le vrai
//     travailleur `snapshot-signer` ;
//   - PIN de vendeur (une session ouverte, une tentative refusée) et son empreinte.
// Puis il cherche chaque valeur, sous ses formes hexadécimale (deux casses), base64, base64url, octets
// et texte, dans toutes les colonnes texte, JSON et binaires de toutes les tables (liste GÉNÉRÉE depuis
// pg_catalog), dans les journaux capturés des trois processus nouveaux (snapshot-content,
// snapshot-signer, maintenance), dans les réponses reçues, dans le snapshot servi et dans
// l'environnement du processus. Exceptions nommées : `pwd_pack_enc` (chiffré sous `K_v`, jamais en clair)
// et l'empreinte du PIN dans `vendor.pin_hash`. Contrôle du contrôle : les mêmes valeurs écrites en
// clair dans une table temporaire et une ligne d'audit, dans une transaction annulée, DOIVENT être
// trouvées. Le balayage ne journalise jamais la valeur trouvée, seulement table, colonne et forme.
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { format } from 'node:util';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool, type Client } from 'pg';
import { FakeKms } from '../../../src/kms/fake-kms';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { WorkerRegistry } from '../../../src/processes/worker';
import { SnapshotSignerRepository } from '../../../src/snapshots-signer/snapshot-signer.repository';
import { SnapshotSignerWorker } from '../../../src/snapshots-signer/snapshot-signer.worker';
import { TenantTx } from '../../../src/db/tenant-tx';
import { MAINT_URL, OWNER_URL, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import {
  makeWorkers,
  SNAPCONTENT_URL,
  type Fixture,
  type Workers,
} from '../../support/snapshot-secrets-db';
import { TEST_WRAPPING_KEY_REF } from '../../../src/kms/fake-kms';
import { activateKey, SNAPSIGN_URL } from '../snapshots-signer/support';
import { ProcessingWorld } from '../offline/processing-fixtures';
import { seedVendor } from '../vendors/vendor-fixtures';

jest.setTimeout(300_000);

// ----- Secrets recherchés et leurs formes -----

type SecretKind = 'pwd-pack' | 'content-key' | 'signing-key' | 'pin' | 'pin-hash';

interface Secret {
  kind: SecretKind;
  value: Buffer | string;
}
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
      insensitive: [escapeRegex(hex)],
      sensitive: [...new Set([base64, base64url])].map(escapeRegex),
      bytes: [
        bytes,
        ...[hex, hex.toUpperCase(), base64, base64url].map((t) => Buffer.from(t, 'utf8')),
      ],
    };
  }
  const text = secret.value;
  if (secret.kind === 'pin-hash')
    return { insensitive: [], sensitive: [escapeRegex(text)], bytes: [Buffer.from(text, 'utf8')] };
  // PIN (6 chiffres) : borné pour ne pas le confondre avec une suite de chiffres d'un identifiant, d'un
  // horodatage ou d'un nombre plus long.
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

/** Genres de secrets trouvés dans un texte (jamais la valeur). */
function secretsInText(text: string, secrets: Secret[]): SecretKind[] {
  const found: SecretKind[] = [];
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

/** Toutes les colonnes texte, json, jsonb, bytea (et tableaux) de toutes les tables ordinaires. */
async function catalogColumns(db: Client): Promise<ScannedColumn[]> {
  const { rows } = await db.query<ScannedColumn>(
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
  return rows;
}

/** Colonnes où l'une des valeurs apparaît : « schéma.table.colonne (n lignes) ». */
async function scanDatabase(
  db: Client,
  secrets: Secret[],
  columnsOf: (db: Client) => Promise<ScannedColumn[]> = catalogColumns,
): Promise<string[]> {
  const needles = needlesOf(secrets);
  const insensitive = needles.insensitive.length
    ? needles.insensitive.join('|')
    : `x${randomUUID()}-jamais`;
  const sensitive = needles.sensitive.length
    ? needles.sensitive.join('|')
    : `x${randomUUID()}-jamais`;
  const byTable = new Map<string, ScannedColumn[]>();
  for (const column of await columnsOf(db)) {
    const table = `${ident(column.schema)}.${ident(column.table)}`;
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  const hits: string[] = [];
  for (const [table, columns] of byTable) {
    const expressions = columns.map((column) =>
      column.mode === 'bytes'
        ? `EXISTS (SELECT 1 FROM unnest(p.b) AS s(v)
                   WHERE position(s.v IN t.${ident(column.column)}) > 0)`
        : `(t.${ident(column.column)}::text ~* p.i OR t.${ident(column.column)}::text ~ p.s)`,
    );
    const counts = expressions.map((e, i) => `count(*) FILTER (WHERE ${e})::int AS c${i}`);
    const { rows } = await db.query<Record<string, number>>(
      `WITH p AS (SELECT $1::text AS i, $2::text AS s, $3::bytea[] AS b)
       SELECT ${counts.join(', ')} FROM ONLY ${table} AS t, p`,
      [insensitive, sensitive, needles.bytes],
    );
    columns.forEach((column, i) => {
      const n = rows[0]![`c${i}`]!;
      if (n > 0) hits.push(`${column.schema}.${column.table}.${column.column} (${n})`);
    });
  }
  return hits;
}

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

describe('aucun secret de la mission hors ligne en clair (SC-007, NFR-008)', () => {
  let world: ProcessingWorld;
  let owner: Pool;
  let contentPool: Pool;
  let signPool: Pool;
  let workers: Workers;
  const kms = new FakeKms();
  const signingRef = `fake-kms:ecc:${randomUUID()}`;
  const secrets: Secret[] = [];
  const add = (kind: SecretKind, value: Buffer | string) => {
    const same = (s: Secret) =>
      s.kind === kind &&
      (Buffer.isBuffer(s.value) && Buffer.isBuffer(value)
        ? s.value.equals(value)
        : s.value === value);
    if (!secrets.some(same)) secrets.push({ kind, value });
  };
  const of = (kind: SecretKind) => secrets.filter((s) => s.kind === kind);
  /** Réponses reçues pendant le parcours (statut, en-têtes, corps). */
  const responses: { what: string; status: number; text: string }[] = [];
  const keep = (what: string, res: { status: number; headers: object; text: string }) =>
    responses.push({
      what,
      status: res.status,
      text: `${JSON.stringify(res.headers)}\n${res.text}`,
    });
  let logged = '';
  let served = '';
  let envText = '';
  let pin = '';
  let wrongPin = '';

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL });
    contentPool = new Pool({ connectionString: SNAPCONTENT_URL });
    signPool = new Pool({ connectionString: SNAPSIGN_URL, max: 4 });
    process.env.DATABASE_URL_MAINT = MAINT_URL;
    world = await ProcessingWorld.create();
    const { w } = world.pw;
    const t1 = await world.terminal();
    const media = await world.pw.media(3, 20_000);
    for (const m of media) add('pwd-pack', m.media.pwdPack);

    // Vendeur au PIN inconnu des autres suites : session ouverte par la route sur un second terminal.
    pin = String(100_000 + randomInt(900_000));
    wrongPin = String(100_000 + ((Number(pin) - 100_000 + 1) % 900_000));
    add('pin', pin);
    const pinHash = await world.pw.hasher.hash(pin);
    const vendorId = await withOwner((db) =>
      seedVendor(db, {
        operatorId: w.ops.a,
        merchantId: world.pw.pos.merchantId,
        actorId: w.operatorAdminA.userId,
        displayName: 'Vendeur du balayage',
        pinHash,
      }),
    );
    add('pin-hash', pinHash);
    const t2 = await world.pw.terminal({ mode: 'CATALOG_POS', session: false });

    // Tout ce que les processus écrivent pendant le parcours est gardé (la sortie réelle reste appelée).
    const lines: string[] = [];
    const spies = [
      jest.spyOn(process.stdout, 'write'),
      jest.spyOn(process.stderr, 'write'),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m)),
    ];
    const push = (m: unknown) => lines.push(String(m));
    Logger.overrideLogger({ log: push, error: push, warn: push, debug: push, verbose: push });
    try {
      // Processus snapshot-content : FULL du grand livre, enveloppes de K_v par terminal.
      workers = makeWorkers(contentPool, { ledgerId: world.ledgerId } as Fixture, kms);
      const keyId = await activateKey(owner, kms, signingRef, w.ops.a);
      expect(keyId).toMatch(/^k13-/);
      expect(await workers.content.runOnce()).toBe(1);

      // Processus snapshot-signer : vérifie, signe (clé du faux service de clés) et publie.
      class OwnLedger extends SnapshotSignerRepository {
        override async readyDrafts() {
          return (await super.readyDrafts()).filter((d) => d.ledgerId === world.ledgerId);
        }
      }
      const signer = new SnapshotSignerWorker(
        new WorkerRegistry(),
        new OwnLedger(new TenantTx(signPool as never)),
        kms,
        { snapshotSigningKeyRef: signingRef } as never,
        { graceMs: 1500, settleAll: true },
      );
      expect(await signer.runOnce()).toBe(1);
      expect(await workers.wrapping.runOnce()).toBeGreaterThanOrEqual(1);

      // Processus maintenance : purges, journal du processus capturé.
      const maintenance = await Test.createTestingModule({
        imports: [MaintenanceProcessModule],
      }).compile();
      const maintApp = maintenance.createNestApplication();
      await maintApp.init();
      await maintApp.get(WorkerRegistry, { strict: false }).drain();
      await maintApp.close();

      // Secrets en clair, retrouvés par le test (la base ne les contient pas).
      const published = await ownerRows<{ version: string; content_key_wrapped: Buffer }>(
        `SELECT version::text, content_key_wrapped FROM offline_snapshot
          WHERE ledger_id = $1 ORDER BY version DESC LIMIT 1`,
        [world.ledgerId],
      );
      expect(published).toHaveLength(1);
      add(
        'content-key',
        await kms.decrypt(TEST_WRAPPING_KEY_REF, published[0]!.content_key_wrapped),
      );
      const jwk = (
        kms as unknown as { signingKey(ref: string): { export(o: object): { d: string } } }
      )
        .signingKey(signingRef)
        .export({ format: 'jwk' });
      add('signing-key', Buffer.from(jwk.d, 'base64url'));

      // Réponses : snapshot servi, configuration, session de vendeur (PIN juste, PIN faux).
      const snap = await t1.t.request(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, {
        method: 'GET',
        path: '/offline-snapshots/current',
      });
      expect(snap.status).toBe(200);
      served = snap.text;
      keep('snapshot servi', snap);
      keep(
        'configuration',
        await t1.t.request(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, {
          method: 'GET',
          path: '/device/config',
        }),
      );
      const session = await t2.t.request(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, {
        method: 'POST',
        path: '/vendor-sessions',
        body: { vendor_id: vendorId, pin },
        idempotencyKey: randomUUID(),
      });
      expect(session.status).toBe(201);
      keep('session de vendeur', session);
      const refused = await t2.t.request(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, {
        method: 'POST',
        path: '/vendor-sessions',
        body: { vendor_id: vendorId, pin: wrongPin },
        idempotencyKey: randomUUID(),
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      keep('PIN refusé', refused);
      // Lot de ventes hors ligne reçu et traité (journal, résultats).
      const version = Number(published[0]!.version);
      const sale = world.sale(t1, media[0]!, 1500, version);
      const batch = await world.submit(t1, [sale]);
      keep('lot hors ligne', batch);
      keep(
        'accusé du snapshot',
        await t1.t.request(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, {
          method: 'POST',
          path: '/offline-snapshots/ack',
          body: { version, content_sha256: '0'.repeat(64) },
        }),
      );
      envText = JSON.stringify(process.env);
    } finally {
      logged = [
        ...lines,
        ...spies.flatMap((spy) =>
          (spy.mock.calls as unknown[][]).map((call) =>
            typeof call[0] === 'string' || Buffer.isBuffer(call[0])
              ? String(call[0])
              : format(...call),
          ),
        ),
      ].join('\n');
      spies.forEach((spy) => spy.mockRestore());
      Logger.overrideLogger(['log', 'error', 'warn']);
    }
  }, 240_000);

  afterAll(async () => {
    await workers?.close();
    await world?.close();
    await owner?.end();
    await contentPool?.end();
    await signPool?.end();
  });

  it('le parcours a bien produit chaque genre de secret', () => {
    for (const kind of ['pwd-pack', 'content-key', 'signing-key', 'pin', 'pin-hash'] as const)
      expect(of(kind).length).toBeGreaterThan(0);
    for (const s of of('pwd-pack')) expect(s.value).toHaveLength(6);
    expect(of('content-key')[0]!.value).toHaveLength(32);
    expect(of('signing-key')[0]!.value).toHaveLength(32);
    expect(served.length).toBeGreaterThan(1000);
  });

  it('le snapshot publié porte des mots de passe chiffrés sous K_v (exception nommée, jamais en clair)', async () => {
    const rows = await ownerRows<{ n: number; pw: number }>(
      `SELECT count(*)::int AS n, count(pwd_pack_enc)::int AS pw FROM offline_snapshot_entry
        WHERE ledger_id = $1`,
      [world.ledgerId],
    );
    expect(rows[0]!.pw).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(served).entries.some((e: { pwd_pack_enc?: unknown }) => e.pwd_pack_enc)).toBe(
      true,
    );
  });

  it('la liste des colonnes vient du catalogue et couvre les tables sensibles', async () => {
    const columns = await withOwner(catalogColumns);
    expect(columns.length).toBeGreaterThan(200);
    const names = new Set(columns.map((c) => `${c.table}.${c.column}`));
    for (const name of [
      'audit_log.before',
      'audit_log.after',
      'api_idempotency.response_body',
      'media.pwd_pack_enc',
      'tag_data_key.encrypted_dek',
      'offline_snapshot.header',
      'offline_snapshot.content_key_wrapped',
      'offline_snapshot_entry.pwd_pack_enc',
      'offline_snapshot_key.envelope',
      'offline_batch.results',
      'vendor.pin_hash',
      'snapshot_signing_key.kms_key_ref',
    ])
      expect(names).toContain(name);
  });

  it('aucune valeur secrète dans la base, sous aucune forme (hors empreinte du PIN du vendeur)', async () => {
    const hits = (await scanReadOnly(secrets)).map((h) => h.replace(/ \(\d+\)$/, ''));
    // Exception nommée : l'empreinte du PIN est dans `vendor.pin_hash`, nulle part ailleurs.
    expect(hits.filter((h) => h !== 'public.vendor.pin_hash')).toEqual([]);
    expect(hits).toContain('public.vendor.pin_hash');
  });

  it('aucune valeur secrète dans les journaux capturés des trois processus', () => {
    expect(logged.length).toBeGreaterThan(0);
    expect(secretsInText(logged, secrets)).toEqual([]);
  });

  it('aucune valeur secrète dans les réponses ni dans le snapshot servi (sauf l’enveloppe chiffrée)', () => {
    expect(responses.map((r) => r.what)).toEqual(
      expect.arrayContaining([
        'snapshot servi',
        'session de vendeur',
        'PIN refusé',
        'lot hors ligne',
      ]),
    );
    for (const r of responses)
      expect({ what: r.what, found: secretsInText(r.text, secrets) }).toEqual({
        what: r.what,
        found: [],
      });
    expect(secretsInText(served, secrets)).toEqual([]);
  });

  it('aucune valeur secrète dans l’environnement du processus', () => {
    expect(envText.length).toBeGreaterThan(100);
    expect(secretsInText(envText, secrets)).toEqual([]);
  });

  it('contrôle du contrôle : les mêmes valeurs écrites en clair sont trouvées, puis annulées', async () => {
    const pwd = of('pwd-pack')[0]!.value as Buffer;
    const kv = of('content-key')[0]!.value as Buffer;
    const sk = of('signing-key')[0]!.value as Buffer;
    const probe = 'zz_offline_secrets_probe';
    const found = await withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(
          `CREATE TABLE public.${probe} (raw bytea, hex_bytes bytea, pin text, b64 varchar(200),
             conf jsonb, many text[], clean text)`,
        );
        await db.query(
          `INSERT INTO public.${probe} (raw, hex_bytes, pin, b64, conf, many, clean)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            kv,
            Buffer.from(pwd.toString('hex'), 'utf8'),
            `PIN ${pin} saisi`,
            `clé ${sk.toString('base64')}`,
            JSON.stringify({ pin }),
            [`x${pwd.toString('hex')}`],
            'rien de secret ici',
          ],
        );
        await db.query(`INSERT INTO audit_log (operator_id, action, after) VALUES ($1, $2, $3)`, [
          world.operatorId,
          'TEST_SECRET_PROBE',
          JSON.stringify({ leak: kv.toString('base64url') }),
        ]);
        return await scanDatabase(db, secrets);
      } finally {
        await db.query('ROLLBACK');
      }
    });
    const columns = found.map((h) => h.replace(/ \(\d+\)$/, ''));
    for (const column of ['raw', 'hex_bytes', 'pin', 'b64', 'conf', 'many'])
      expect(columns).toContain(`public.${probe}.${column}`);
    expect(columns).toContain('public.audit_log.after');
    expect(columns).not.toContain(`public.${probe}.clean`);
    expect(await ownerRows(`SELECT to_regclass('public.${probe}') AS t`)).toEqual([{ t: null }]);
    expect(await ownerRows(`SELECT 1 FROM audit_log WHERE action = 'TEST_SECRET_PROBE'`)).toEqual(
      [],
    );
    // Texte (journaux, réponses, environnement) : chaque genre est trouvé sous ses formes.
    expect(secretsInText(sk.toString('hex').toUpperCase(), secrets)).toEqual(['signing-key']);
    expect(secretsInText(`"${kv.toString('base64')}"`, secrets)).toEqual(['content-key']);
    expect(secretsInText(`{"pin":"${pin}"}`, secrets)).toEqual(['pin']);
    expect(secretsInText(of('pin-hash')[0]!.value as string, secrets)).toEqual(['pin-hash']);
    expect(secretsInText(`un${pin}x`, secrets)).toEqual([]); // borné : pas dans un nombre plus long
    process.env.ZZ_SECRET_PROBE = pwd.toString('hex');
    try {
      expect(secretsInText(JSON.stringify(process.env), secrets)).toEqual(['pwd-pack']);
    } finally {
      delete process.env.ZZ_SECRET_PROBE;
    }
  });

  it('contrôle du contrôle : un balayage dont la liste de colonnes est vidée ne passe pas pour une preuve', async () => {
    // Même fonction, liste vide : rien n'est trouvé, y compris l'empreinte du PIN pourtant présente ;
    // l'exception nommée du test de base (hits contient vendor.pin_hash) échouerait alors.
    const emptied = await withOwner((db) => scanDatabase(db, secrets, async () => []));
    expect(emptied).toEqual([]);
    const real = await scanReadOnly(secrets);
    expect(real.map((h) => h.replace(/ \(\d+\)$/, ''))).toContain('public.vendor.pin_hash');
  });
});
