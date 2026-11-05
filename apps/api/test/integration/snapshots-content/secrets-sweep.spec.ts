// Intégration (WP12, T052) : balayage du canari. Un bracelet dont le mot de passe est
// reconnaissable
// traverse tout le processus (FULL, enveloppes) ; le canari n'apparaît en clair ni dans les tables
// `offline_snapshot*`, ni dans `audit_log`, ni dans les journaux (console, journal Nest), sous
// aucune
// des formes hexadécimale, base64, base64url ou octets. Un contrôle positif prouve que le balayage
// trouve.
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { FakeKms } from '../../../src/kms/fake-kms';
import { OWNER_URL } from '../../support/db';
import {
  addBracelet,
  addTerminal,
  CANARY,
  createFixture,
  dekPlaintext,
  makeWorkers,
  newTerminal,
  publishReady,
  SNAPCONTENT_URL,
  type Fixture,
  type Workers,
} from '../../support/snapshot-secrets-db';

/** Formes textuelles du canari : hex (min. et maj.), base64 et base64url à chaque alignement. */
function textForms(secret: Buffer): Map<string, string> {
  const forms = new Map<string, string>([
    ['hex', secret.toString('hex')],
    ['HEX', secret.toString('hex').toUpperCase()],
  ]);
  for (const [name, encoding] of [
    ['base64', 'base64'],
    ['base64url', 'base64url'],
  ] as const) {
    for (const offset of [0, 1, 2]) {
      const text = Buffer.concat([Buffer.alloc(offset), secret]).toString(encoding);
      // Caractères entièrement portés par le secret (6 bits chacun), quel que soit l'octet voisin.
      const first = Math.ceil((8 * offset) / 6);
      const last = Math.floor((8 * (offset + secret.length)) / 6);
      forms.set(`${name}+${offset}`, text.slice(first, last));
    }
  }
  return forms;
}

const FORMS = textForms(CANARY);

/** Formes du canari trouvées dans un texte. */
function foundIn(text: string): string[] {
  return [...FORMS].filter(([, form]) => text.includes(form)).map(([name]) => name);
}

describe('snapshot-content : le mot de passe n’apparaît en clair nulle part (WP12)', () => {
  let owner: Pool;
  let content: Pool;
  let kms: FakeKms;
  let f: Fixture;
  let w: Workers;
  const logs: string[] = [];
  const spies: Array<jest.SpyInstance> = [];

  /** Toutes les colonnes (texte, jsonb, bytea) des lignes du test, rendues en texte par la base. */
  async function sweepTables(): Promise<Record<string, string[]>> {
    const { rows: tables } = await owner.query<{ table_name: string; scope: string }>(
      `SELECT t.table_name,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                                 WHERE c.table_name = t.table_name AND c.column_name = 'ledger_id')
                   THEN 'ledger_id' ELSE 'operator_id' END AS scope
         FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND (t.table_name LIKE 'offline_snapshot%' OR t.table_name = 'audit_log')`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(['offline_snapshot_draft', 'offline_snapshot_entry', 'audit_log']),
    );
    const out: Record<string, string[]> = {};
    for (const { table_name: table, scope } of tables) {
      const value = scope === 'ledger_id' ? f.ledgerId : f.operatorId;
      const client = await owner.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
        const { rows } = await client.query<{ line: string }>(
          `SELECT r::text AS line FROM ${table} r WHERE r.${scope} = $1`,
          [value],
        );
        await client.query('COMMIT');
        out[table] = rows.map((r) => r.line);
      } finally {
        client.release();
      }
    }
    return out;
  }

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL });
    content = new Pool({ connectionString: SNAPCONTENT_URL });
    kms = new FakeKms();
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(
        jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(' '));
        }),
      );
    }
    Logger.overrideLogger({
      log: (m: unknown) => logs.push(String(m)),
      error: (m: unknown) => logs.push(String(m)),
      warn: (m: unknown) => logs.push(String(m)),
      debug: (m: unknown) => logs.push(String(m)),
      verbose: (m: unknown) => logs.push(String(m)),
    });
    f = await createFixture(owner, kms);
    const dek = await dekPlaintext(owner, kms, f);
    // Trois bracelets portant le canari, un sans mot de passe ; deux terminaux.
    for (let i = 0; i < 3; i += 1) await addBracelet(owner, f, dek);
    await addBracelet(owner, f, dek, null);
    dek.fill(0);
    await addTerminal(owner, f, newTerminal());
    await addTerminal(owner, f, newTerminal());
    w = makeWorkers(content, f, kms);
    expect(await w.content.runOnce()).toBe(1);
    await publishReady(owner, f);
    expect(await w.wrapping.runOnce()).toBe(2);
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    Logger.overrideLogger(['log', 'error', 'warn']);
    await w.close();
    await owner.end();
    await content.end();
  });

  it('le FULL porte bien des mots de passe chiffrés (le balayage a de quoi chercher)', async () => {
    const { rows } = await owner.query(
      'SELECT count(*)::int AS n, count(pwd_pack_enc)::int AS pw FROM offline_snapshot_entry ' +
        'WHERE ledger_id = $1',
      [f.ledgerId],
    );
    expect(rows[0]).toEqual({ n: 4, pw: 3 });
  });

  it('contrôle positif : le balayage trouve le canari sous chacune de ses formes', async () => {
    const probe = `wp12_probe_${Date.now()}`;
    await owner.query(`CREATE TABLE ${probe} (b bytea, txt text, j jsonb)`);
    try {
      const around = (offset: number): Buffer =>
        Buffer.concat([Buffer.alloc(offset, 7), CANARY, Buffer.alloc(3, 9)]);
      const texts = [
        around(0).toString('hex'),
        ...[0, 1, 2].map((offset) => around(offset).toString('base64')),
        ...[0, 1, 2].map((offset) => around(offset).toString('base64url')),
      ];
      for (const text of texts)
        await owner.query(`INSERT INTO ${probe} (txt, j) VALUES ($1, $2)`, [
          text,
          JSON.stringify({ k: text }),
        ]);
      await owner.query(`INSERT INTO ${probe} (b) VALUES ($1)`, [around(1)]);
      const { rows } = await owner.query<{ line: string }>(
        `SELECT r::text AS line FROM ${probe} r`,
      );
      const found = new Set(rows.flatMap((r) => foundIn(r.line)));
      expect([...found].sort()).toEqual([...FORMS.keys()].filter((k) => k !== 'HEX').sort());
      // Chaque ligne de la sonde est trouvée (texte, jsonb, octets).
      for (const row of rows) expect(foundIn(row.line).length).toBeGreaterThan(0);
    } finally {
      await owner.query(`DROP TABLE ${probe}`);
    }
  });

  it('contrôle positif des journaux : un canari journalisé est trouvé', () => {
    const before = logs.length;
    console.log(`fuite simulée ${CANARY.toString('hex')}`);
    new Logger('sonde').error(`fuite simulée ${CANARY.toString('base64')}`);
    const added = logs.slice(before).join('\n');
    expect(foundIn(added).sort()).toEqual(expect.arrayContaining(['hex', 'base64+0']));
    logs.length = before;
  });

  it('le canari n’apparaît dans aucune table offline_snapshot*, ni audit_log', async () => {
    const swept = await sweepTables();
    const leaks = Object.entries(swept).flatMap(([table, lines]) =>
      lines.flatMap((line) => foundIn(line).map((form) => `${table}:${form}`)),
    );
    expect(leaks).toEqual([]);
    // Les tables balayées contiennent bien des données du test.
    expect(swept.offline_snapshot_entry).toHaveLength(4);
    expect(swept.offline_snapshot_key).toHaveLength(2);
  });

  it('ni dans les journaux capturés (console.*, journal Nest) ni dans les erreurs', async () => {
    expect(foundIn(logs.join('\n'))).toEqual([]);
  });
});
