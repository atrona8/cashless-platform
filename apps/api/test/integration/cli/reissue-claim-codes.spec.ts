// Intégration : commande d'exploitation `reissue-claim-codes` (mission serveur-app-festivalier, WP08 ; FR-007, FR-008,
// SC-003). La commande est lancée pour de bon (sous-processus `tsx`), en `NODE_ENV=production` et sous le rôle
// `cashless_claimadmin`. Elle pose des lignes en version 2 du secret, globale à la base : la suite tourne seule, en
// série (CI), et remet à 1 les lignes de version 2 après chaque essai (voir `claim-rotation.spec.ts`).
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import { loadConfig } from '../../../src/config/config';
import { EXIT, exitCodeForSqlState, parseArgs } from '../../../src/cli/reissue-claim-codes';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { createTestApp } from '../../support/app';
import { APP_URL, CLAIMADMIN_URL, connect, OWNER_URL, withOwner } from '../../support/db';
import { createTestCustomer } from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  ownerRows as rows,
  seedPersonalizedMedia,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

const API_DIR = join(__dirname, '../../..');
const DOMAIN = 'pay.exemple.sn';
const SECRET_1 = loadConfig({ NODE_ENV: 'test' }).claimCodeHmacKey;
const SECRET_2_HEX = 'cd'.repeat(32);

describe('commande reissue-claim-codes : fonctions pures (sans base)', () => {
  const OP = randomUUID();
  const BATCH = randomUUID();

  it('arguments : les trois obligatoires, aucun autre, jamais d’écho d’une valeur', () => {
    expect(parseArgs(['--operator', OP, '--batch', BATCH, '--out', 'x.csv'])).toEqual({
      operator: OP,
      batch: BATCH,
      out: 'x.csv',
    });
    for (const argv of [
      [],
      ['--operator', OP, '--batch', BATCH],
      ['--operator', OP, '--batch', BATCH, '--out', 'x', '--force', '1'],
      ['--operator', OP, '--operator', OP, '--batch', BATCH, '--out', 'x'],
      ['--operator', OP, '--batch', '--out', 'x'],
    ])
      expect(parseArgs(argv)).toHaveProperty('error');
    const bad = parseArgs(['--operator', 'secret-pas-un-uuid', '--batch', BATCH, '--out', 'x']);
    expect(bad).toHaveProperty('error');
    expect(JSON.stringify(bad)).not.toContain('secret-pas-un-uuid');
  });

  it('table des codes de sortie : lot non PUBLIC ou introuvable 2, le reste 1', () => {
    expect(exitCodeForSqlState('CL020')).toBe(EXIT.BATCH);
    expect(exitCodeForSqlState('P0002')).toBe(EXIT.BATCH);
    for (const state of ['CL064', '23505', '42501', 'CL001', '57P01', undefined])
      expect(exitCodeForSqlState(state)).toBe(EXIT.ERROR);
    expect([EXIT.OK, EXIT.ERROR, EXIT.BATCH, EXIT.NOTHING]).toEqual([0, 1, 2, 3]);
  });
});

describe('commande reissue-claim-codes : de bout en bout', () => {
  let w: MediaWorld;
  let rotated: INestApplication;
  let dir: string;
  let counter = 0;
  const hashers = {
    v1: new ClaimHasher({ claimCodeHmacKey: SECRET_1, claimCodeKeyVersion: 1 }),
    v2: new ClaimHasher({
      claimCodeHmacKey: Buffer.from(SECRET_2_HEX, 'hex'),
      claimCodeKeyVersion: 2,
    }),
  };
  /** Tous les codes en clair vus par la suite (anciens et nouveaux) : cherchés dans la base à la fin. */
  const plain: string[] = [];

  const outFile = () => join(dir, `codes-${(counter += 1)}.csv`);

  interface Result {
    status: number | null;
    stdout: string;
    stderr: string;
  }
  /** Lance la commande telle que la procédure la donne (la version compilée est `dist/…js`, même source). */
  const reissue = (
    operator: string,
    batch: string,
    out: string,
    env: Record<string, string | undefined> = {},
  ): Result => {
    const child = spawnSync(
      process.execPath,
      [
        '--require',
        'tsx/cjs',
        'src/cli/reissue-claim-codes.ts',
        '--operator',
        operator,
        '--batch',
        batch,
        '--out',
        out,
      ],
      {
        cwd: API_DIR,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: 'production',
          CLAIM_CODE_HMAC_KEY: SECRET_2_HEX,
          CLAIM_CODE_HMAC_KEY_VERSION: '2',
          CLAIM_CODE_DOMAIN: DOMAIN,
          DATABASE_URL_CLAIMADMIN: CLAIMADMIN_URL,
          ...env,
        },
      },
    );
    return { status: child.status, stdout: child.stdout, stderr: child.stderr };
  };

  /** Lot PUBLIC de `count` bracelets avec un code de la version 1 (jamais utilisé), actifs au solde nul. */
  const world = async (
    count: number,
    options: { kind?: 'PUBLIC' | 'STAFF'; closed?: boolean; withCodes?: boolean } = {},
  ) =>
    withOwner(async (db) => {
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        kind: options.kind ?? 'PUBLIC',
        quantity: count,
        status: 'ACTIVE',
      });
      const media = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count,
      });
      const old = new Map<string, string>();
      for (const m of media) {
        if (options.withCodes === false) continue;
        const code = generateClaimCode(randomBytes);
        plain.push(code);
        const hash = hashers.v1.claimCodeHash(code);
        await db.query(
          `INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version, media_id, associated_at)
           VALUES ($1, $2, $3, 1, $4, now())`,
          [w.ops.a, batch, hash, m.id],
        );
        await db.query(
          'UPDATE media SET claim_code_hash = $2, claim_key_version = 1 WHERE id = $1',
          [m.id, hash],
        );
        old.set(m.id, code);
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        const wallet = (
          await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
        ).rows[0]!.id;
        await activateMedia(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          walletId: wallet,
          mediaIds: [m.id],
        });
      }
      if (options.closed)
        await db.query(`UPDATE media_batch SET status = 'CLOSED' WHERE id = $1`, [batch]);
      return { batch, media, old };
    });

  const claim = async (app: INestApplication, code: string) => {
    const who = await withOwner((db) => createTestCustomer(db, w.ops.a));
    return request(app.getHttpServer())
      .post('/v1/me/media')
      .set(who.headers)
      .set('Idempotency-Key', randomUUID())
      .send({ claim_code: code });
  };

  /** Lignes du fichier de commande : rank, code (sans tiret), url, uid (hex), numéro imprimé ('' si absent). */
  const parseOrder = (path: string) => {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines[0]).toBe('rank,code,url,uid,printed_number');
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      expect(cells).toHaveLength(5);
      const [rank, code, url, uid, printed] = cells as [string, string, string, string, string];
      const clean = code.replace('-', '');
      plain.push(clean);
      return { rank: Number(rank), code: clean, url, uid, printed };
    });
  };
  const countV2 = (batch: string) =>
    rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM claim_code
        WHERE batch_id = $1 AND key_version = 2 AND media_id IS NOT NULL AND invalidated_at IS NULL`,
      [batch],
    ).then((r) => r[0]!.n);
  const snapshot = (batch: string) =>
    rows(
      `SELECT m.id, m.claim_code_hash, m.claim_key_version, c.n_codes
         FROM media m, (SELECT count(*)::int AS n_codes FROM claim_code WHERE batch_id = $1) c
        WHERE m.batch_id = $1 ORDER BY m.id`,
      [batch],
    );

  const restoreVersions = () =>
    withOwner(async (db) => {
      const ops = [w.ops.a, w.ops.b];
      for (const sql of [
        'UPDATE media SET claim_key_version = 1 WHERE operator_id = ANY($1) AND claim_key_version = 2',
        'UPDATE claim_code SET key_version = 1 WHERE operator_id = ANY($1) AND key_version = 2',
        'UPDATE media_claim SET key_version = 1 WHERE operator_id = ANY($1) AND key_version = 2',
      ])
        await db.query(sql, [ops]);
    });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reissue-claim-codes-'));
    w = await createMediaWorld();
    await withOwner((db) => goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId));
    const saved = {
      key: process.env.CLAIM_CODE_HMAC_KEY,
      version: process.env.CLAIM_CODE_HMAC_KEY_VERSION,
    };
    try {
      // API de la version 2 (nouveau secret), démarrée avant que la base ne porte une ligne de version 2.
      process.env.CLAIM_CODE_HMAC_KEY = SECRET_2_HEX;
      process.env.CLAIM_CODE_HMAC_KEY_VERSION = '2';
      rotated = await createTestApp({ identity: w.idp, trustProxyHops: 1 });
    } finally {
      for (const [name, value] of [
        ['CLAIM_CODE_HMAC_KEY', saved.key],
        ['CLAIM_CODE_HMAC_KEY_VERSION', saved.version],
      ] as const)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  });

  afterEach(restoreVersions);

  afterAll(async () => {
    await restoreVersions();
    await rotated?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('SC-003 : rotation, ancien code refusé, réémission, import du fichier, nouveau code accepté', async () => {
    const { batch, media, old } = await world(6);
    await withOwner((db) =>
      db.query(
        `UPDATE media SET printed_number = 'FS26-' || upper(right(id::text, 4))
          WHERE id = ANY($1::uuid[])`,
        [[media[0]!.id, media[3]!.id]],
      ),
    );
    // 1. Rotation (secret 2, version 2, API redémarrée) : l'ancien code vaut un code inconnu.
    const oldRefused = await claim(rotated, old.get(media[0]!.id)!);
    expect(oldRefused.status).toBe(422);
    expect(oldRefused.body.code).toBe('MEDIA_CLAIM_INVALID');
    // 2. Réémission.
    const out = outFile();
    const res = reissue(w.ops.a, batch, out);
    expect(res).toMatchObject({ status: EXIT.OK, stdout: '6\n' });
    // 3. Fichier : mode 0600, en-tête, une ligne par bracelet, URL du domaine configuré.
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const order = parseOrder(out);
    expect(order.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const line of order) expect(line.url).toBe(`https://${DOMAIN}/c/${line.code}`);
    expect(new Set(order.map((o) => o.code)).size).toBe(6);
    expect(await countV2(batch)).toBe(6);
    // Chaque ligne nomme son bracelet : UID et numéro imprimé de la base.
    const byUid = new Map(
      (
        await rows<{ id: string; uid: Buffer; printed_number: string | null }>(
          'SELECT id, nfc_uid AS uid, printed_number FROM media WHERE batch_id = $1',
          [batch],
        )
      ).map((r) => [r.uid.toString('hex'), r]),
    );
    expect(new Set(order.map((o) => o.uid)).size).toBe(6);
    for (const line of order) {
      expect(byUid.get(line.uid)).toBeDefined();
      expect(line.printed).toBe(byUid.get(line.uid)!.printed_number ?? '');
    }
    expect(order.filter((o) => o.printed !== '')).toHaveLength(2);
    // 4. Aucun import : chaque nouveau code rattache le bracelet de SA ligne ; l'ancien reste refusé.
    for (const line of order) {
      const ok = await claim(rotated, line.code);
      expect(ok.status).toBe(201);
      expect(ok.body.media_id).toBe(byUid.get(line.uid)!.id);
    }
    expect((await claim(rotated, old.get(media[1]!.id)!)).status).toBe(422);
  });

  it('bracelet sans UID : toute la réémission refusée avant le fichier (code 1)', async () => {
    const { batch, media } = await world(3);
    await withOwner((db) =>
      db.query('UPDATE media SET nfc_uid = NULL WHERE id = $1', [media[1]!.id]),
    );
    const before = await snapshot(batch);
    const out = outFile();
    const res = reissue(w.ops.a, batch, out);
    expect(res).toMatchObject({ status: EXIT.ERROR, stdout: '' });
    expect(res.stderr).toContain('UID');
    expect(existsSync(out)).toBe(false);
    expect(await snapshot(batch)).toEqual(before);
  });

  it('lot clos : réémis comme un autre ; lot STAFF, inconnu ou d’un autre prestataire : code 2, aucun fichier', async () => {
    const closed = await world(3, { closed: true });
    const out = outFile();
    expect(reissue(w.ops.a, closed.batch, out)).toMatchObject({ status: EXIT.OK, stdout: '3\n' });
    expect(parseOrder(out)).toHaveLength(3);
    const staff = await world(2, { kind: 'STAFF', withCodes: false });
    const other = await withOwner((db) =>
      createBatch(db, { operatorId: w.ops.b, organizerId: w.ids.organizerB, status: 'ACTIVE' }),
    );
    for (const batch of [staff.batch, randomUUID(), other]) {
      const file = outFile();
      const res = reissue(w.ops.a, batch, file);
      expect(res).toMatchObject({ status: EXIT.BATCH, stdout: '' });
      expect(existsSync(file)).toBe(false);
    }
  });

  it('code déjà servi : bracelet ignoré, ni écrasé ni dans le fichier ; tous servis : code 3', async () => {
    const { batch, media } = await world(4);
    const [used, ...others] = media as [SeededMedia, ...SeededMedia[]];
    const usedHash = (
      await rows<{ h: Buffer }>('SELECT claim_code_hash AS h FROM media WHERE id = $1', [used.id])
    )[0]!.h;
    await withOwner((db) =>
      db.query('UPDATE media SET claim_code_used_at = now() WHERE id = $1', [used.id]),
    );
    const out = outFile();
    expect(reissue(w.ops.a, batch, out)).toMatchObject({ status: EXIT.OK, stdout: '3\n' });
    expect(parseOrder(out)).toHaveLength(3);
    const after = await rows<{ id: string; h: Buffer; v: number }>(
      'SELECT id, claim_code_hash AS h, claim_key_version AS v FROM media WHERE batch_id = $1',
      [batch],
    );
    expect(after.find((r) => r.id === used.id)).toMatchObject({ h: usedHash, v: 1 });
    expect(
      after
        .filter((r) => r.v === 2)
        .map((r) => r.id)
        .sort(),
    ).toEqual(others.map((m) => m.id).sort());
    await withOwner((db) =>
      db.query('UPDATE media SET claim_code_used_at = now() WHERE batch_id = $1', [batch]),
    );
    const file = outFile();
    expect(reissue(w.ops.a, batch, file)).toMatchObject({ status: EXIT.NOTHING, stdout: '' });
    expect(existsSync(file)).toBe(false);
  });

  it('fichier existant : jamais écrasé (code 1), base intacte', async () => {
    const { batch } = await world(3);
    const out = outFile();
    writeFileSync(out, 'contenu a ne pas perdre\n', { mode: 0o644 });
    const before = await snapshot(batch);
    const res = reissue(w.ops.a, batch, out);
    expect(res).toMatchObject({ status: EXIT.ERROR, stdout: '' });
    expect(readFileSync(out, 'utf8')).toBe('contenu a ne pas perdre\n');
    expect(await snapshot(batch)).toEqual(before);
  });

  it('base refusée : aucun fichier ne reste, codes ni empreintes dans les messages', async () => {
    const { batch } = await world(3);
    const before = await snapshot(batch);
    const trigger = `wp08_refuse_${batch.replaceAll('-', '')}`;
    for (const [state, expected] of [
      ['CL064', EXIT.ERROR],
      ['23505', EXIT.ERROR], // trois tirages, puis abandon
    ] as const) {
      await withOwner(async (db) => {
        await db.query(
          `CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS
           $$ BEGIN RAISE EXCEPTION 'refus d''essai' USING ERRCODE = '${state}'; END $$`,
        );
        await db.query(
          `CREATE TRIGGER ${trigger} BEFORE INSERT ON claim_code FOR EACH ROW
           WHEN (NEW.batch_id = '${batch}') EXECUTE FUNCTION ${trigger}()`,
        );
      });
      try {
        const out = outFile();
        const res = reissue(w.ops.a, batch, out);
        expect(res).toMatchObject({ status: expected, stdout: '' });
        expect(existsSync(out)).toBe(false);
        expect(res.stderr).toContain(`SQLSTATE ${state}`);
        expect(res.stderr).not.toMatch(/[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{6}/);
      } finally {
        await withOwner(async (db) => {
          await db.query(`DROP TRIGGER IF EXISTS ${trigger} ON claim_code`);
          await db.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
        });
      }
      expect(await snapshot(batch)).toEqual(before);
    }
  });

  it('aucun code ailleurs que dans le fichier : sortie, erreur, audit, base', async () => {
    const { batch } = await world(3);
    const out = outFile();
    const res = reissue(w.ops.a, batch, out);
    expect(res.stdout).toBe('3\n');
    expect(res.stderr).toBe('');
    const order = parseOrder(out);
    for (const { code } of order) {
      expect(res.stdout + res.stderr).not.toContain(code);
      expect(readFileSync(out, 'utf8')).toContain(code.slice(0, 4));
    }
    const audit = await rows<{ after: unknown; actor_id: string | null; origin: string }>(
      `SELECT after, actor_id, origin FROM audit_log
        WHERE operator_id = $1 AND action = 'CLAIM_CODES_REISSUED' AND object_id = $2`,
      [w.ops.a, batch],
    );
    expect(audit).toEqual([
      { after: { count: 3, key_version: 2 }, actor_id: null, origin: 'claim-admin' },
    ]);
    // Recherche du code en clair (avec ou sans tiret) dans toutes les tables du prestataire.
    const pattern = plain.map((c) => `${c.slice(0, 4)}-?${c.slice(4)}`).join('|');
    const tables = await rows<{ table_name: string }>(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema = 'public' AND c.column_name = 'operator_id'
          AND t.table_type = 'BASE TABLE'`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(['audit_log', 'media', 'claim_code']),
    );
    const hits: string[] = [];
    for (const { table_name: table } of tables) {
      const found = await rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${table}" t WHERE t.operator_id = $2 AND t::text ~* $1`,
        [pattern, w.ops.a],
      );
      if (found[0]!.n > 0) hits.push(table);
    }
    expect(hits).toEqual([]);
  });

  it('droits : cashless_app ne peut pas réémettre, la commande refuse ce rôle et le propriétaire', async () => {
    const { batch } = await world(2);
    const app = await connect(APP_URL);
    try {
      await expect(
        app.query(
          `SELECT reissue_claim_codes($1, $2, ARRAY[$3]::uuid[], ARRAY[$4]::bytea[], 2::smallint)`,
          [w.ops.a, batch, randomUUID(), Buffer.alloc(32)],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        app.query('SELECT * FROM reissuable_media($1, $2, 2::smallint)', [w.ops.a, batch]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
    const before = await snapshot(batch);
    // Garde de production : ni cashless_app (non membre), ni le propriétaire (superutilisateur).
    for (const url of [APP_URL, OWNER_URL]) {
      const out = outFile();
      const res = reissue(w.ops.a, batch, out, { DATABASE_URL_CLAIMADMIN: url });
      expect(res).toMatchObject({ status: EXIT.ERROR, stdout: '' });
      expect(res.stderr).toContain('cashless_claimadmin exigé');
      expect(existsSync(out)).toBe(false);
    }
    // Hors production la garde de rôle ne joue pas, mais cashless_app n'a aucun droit sur la liste : code 1.
    const out = outFile();
    const res = reissue(w.ops.a, batch, out, {
      NODE_ENV: 'test',
      DATABASE_URL_CLAIMADMIN: APP_URL,
    });
    expect(res).toMatchObject({ status: EXIT.ERROR, stdout: '' });
    expect(res.stderr).toContain('SQLSTATE 42501');
    expect(existsSync(out)).toBe(false);
    // Variable absente : code 1, qui la nomme.
    const absent = reissue(w.ops.a, batch, outFile(), { DATABASE_URL_CLAIMADMIN: undefined });
    expect(absent.status).toBe(EXIT.ERROR);
    expect(absent.stderr).toContain('DATABASE_URL_CLAIMADMIN');
    expect(await snapshot(batch)).toEqual(before);
  });

  it('version inférieure à la plus haute de la base (rotation à l’envers) : code 1, aucun fichier', async () => {
    const { batch } = await world(2);
    // Une autre ligne de la base porte déjà la version 2 (avec la plus haute version connue : 2).
    await world(1).then(({ media }) =>
      withOwner((db) =>
        db.query('UPDATE media SET claim_key_version = 2 WHERE id = $1', [media[0]!.id]),
      ),
    );
    const before = await snapshot(batch);
    const out = outFile();
    const res = reissue(w.ops.a, batch, out, { CLAIM_CODE_HMAC_KEY_VERSION: '1' });
    expect(res).toMatchObject({ status: EXIT.ERROR, stdout: '' });
    expect(res.stderr).toContain('rotation à l’envers');
    expect(existsSync(out)).toBe(false);
    expect(await snapshot(batch)).toEqual(before);
  });

  it('procédure : les commandes, variables et codes de sortie cités existent', () => {
    const doc = readFileSync(
      join(API_DIR, '../../docs/procedure-rotation-codes-rattachement.md'),
      'utf8',
    );
    for (const text of [
      'apps/api/dist/cli/reissue-claim-codes.js',
      '--operator',
      '--batch',
      '--out',
      'DATABASE_URL_CLAIMADMIN',
      'CLAIM_CODE_HMAC_KEY_VERSION',
      'openssl rand -hex 32',
      'contracts/claim-code-rotation.md',
    ])
      expect(doc).toContain(text);
    expect(existsSync(join(API_DIR, 'src/cli/reissue-claim-codes.ts'))).toBe(true);
    expect(readFileSync(join(API_DIR, 'tsconfig.build.json'), 'utf8')).toContain('"src"');
  });
});
