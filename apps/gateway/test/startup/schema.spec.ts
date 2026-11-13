import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_DIR, MigrationError } from '../../src/db/migrate';
import { GatewayTx } from '../../src/db/gateway-tx';
import { createTestDb, type TestDb } from './_support/db';

const HASH = Buffer.alloc(32, 7);
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
const q = (sql: string, params: unknown[] = []) => db.pool.query(sql, params);

async function insertOp(seq: number, key: string): Promise<void> {
  await q(
    `INSERT INTO edge_op (edge_seq, origin_key, type, authorized_mode, device_serial, device_id, operation,
                          content_sha256, chain_hash, occurred_at, recorded_at)
     VALUES ($1, $2, 'PURCHASE', 'EDGE_ONLINE', 'T1', gen_random_uuid(), '{"a":1}', $3, $3, now(), now())`,
    [seq, key, HASH],
  );
}

describe('edge-0001', () => {
  it('toutes les tables de data-model.md B existent, propriété d’un rôle non superutilisateur', async () => {
    const expected = [
      'edge_meta',
      'edge_authority',
      'edge_clock',
      'edge_chain_head',
      'edge_op',
      'edge_op_delta',
      'edge_device_batch',
      'edge_outgoing_batch',
      'edge_wallet',
      'edge_media',
      'edge_tap',
      'edge_replication_cursor',
      'edge_cash_session',
      'edge_vendor_session',
      'edge_vendor',
      'edge_device',
      'edge_device_token_family',
      'edge_identity_key',
      'edge_staff',
      'edge_catalog_item',
      'edge_event_setting',
      'edge_wallet_limit',
      'edge_wallet_state',
      'edge_pwd_pack_key',
      'edge_device_nonce',
      'edge_idempotency',
      'edge_device_seq',
      'edge_token_key',
      'edge_audit',
      'edge_snapshot',
      'edge_snapshot_entry',
      'edge_snapshot_key',
      'edge_snapshot_ack',
      'edge_site_order_key',
      'edge_authority_transition',
    ];
    const { rows } = await q(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    const names = rows.map((r: { relname: string }) => r.relname);
    for (const t of expected) expect(names).toContain(t);
    expect(new Set(rows.map((r: { owner: string }) => r.owner))).toEqual(new Set(['edge_app']));
    const su = await q("SELECT rolsuper FROM pg_roles WHERE rolname = 'edge_app'");
    expect(su.rows[0].rolsuper).toBe(false);
  });

  it('aucun droit pour PUBLIC sur les tables', async () => {
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee = 'PUBLIC'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('edge_op : UPDATE d’un champ de contenu et DELETE refusés, UPDATE central_status permis', async () => {
    await insertOp(1, 'A:1');
    await expect(
      q('UPDATE edge_op SET operation = \'{"a":2}\' WHERE edge_seq = 1'),
    ).rejects.toThrow(/non modifiable/);
    await expect(
      q('UPDATE edge_op SET chain_hash = $1 WHERE edge_seq = 1', [Buffer.alloc(32, 1)]),
    ).rejects.toThrow();
    await expect(q('DELETE FROM edge_op WHERE edge_seq = 1')).rejects.toThrow(/interdit/);
    await expect(q('TRUNCATE edge_op CASCADE')).rejects.toThrow(/interdit/);
    await q("UPDATE edge_op SET central_status = 'SENT' WHERE edge_seq = 1");
    await expect(
      q("UPDATE edge_op SET central_status = 'BOGUS' WHERE edge_seq = 1"),
    ).rejects.toThrow();
    await expect(q("UPDATE edge_op SET type = 'BOGUS' WHERE edge_seq = 1")).rejects.toThrow();
  });

  it('edge_op : origin_key unique, numéros sans trou', async () => {
    await expect(insertOp(2, 'A:1')).rejects.toThrow(/origin_key|unique/);
    await expect(insertOp(5, 'A:5')).rejects.toThrow(/sans trou/);
    await insertOp(2, 'A:2');
  });

  it('edge_chain_head : une seule ligne ; hash de 32 octets', async () => {
    await q('INSERT INTO edge_chain_head (last_chain_hash) VALUES ($1)', [HASH]);
    await expect(
      q('INSERT INTO edge_chain_head (last_chain_hash) VALUES ($1)', [HASH]),
    ).rejects.toThrow();
    await expect(
      q('INSERT INTO edge_chain_head (id, last_chain_hash) VALUES (false, $1)', [HASH]),
    ).rejects.toThrow();
    await expect(q('DELETE FROM edge_chain_head')).rejects.toThrow(/reculent/);
  });

  it('edge_outgoing_batch : deux lots non DONE refusés', async () => {
    const ins = (id: string, status: string) =>
      q(
        `INSERT INTO edge_outgoing_batch (batch_id, edge_seq_from, edge_seq_to, epoch, body_sha256, status)
         VALUES ($1, 1, 1, 1, $2, $3)`,
        [id, HASH, status],
      );
    await ins('00000000-0000-4000-8000-000000000001', 'PREPARED');
    await expect(ins('00000000-0000-4000-8000-000000000002', 'SENT')).rejects.toThrow(
      /one_in_flight|unique/,
    );
    await ins('00000000-0000-4000-8000-000000000003', 'DONE');
    await q("UPDATE edge_outgoing_batch SET status = 'DONE'");
    await ins('00000000-0000-4000-8000-000000000002', 'SENT');
  });

  it('edge_authority : transitions absentes refusées, RELEASING -> ACTIVE exige handover_failed_epoch', async () => {
    await expect(q("INSERT INTO edge_authority (state) VALUES ('ACTIVE')")).rejects.toThrow(
      /état initial/,
    );
    await q("INSERT INTO edge_authority (state) VALUES ('ARMED')");
    await expect(
      q('INSERT INTO edge_authority (id, state) VALUES (false, $1)', ['ARMED']),
    ).rejects.toThrow();
    await expect(q("UPDATE edge_authority SET state = 'ACTIVE'")).rejects.toThrow(/transition/);
    await expect(q("UPDATE edge_authority SET state = 'RELEASED'")).rejects.toThrow(/transition/);
    await q("UPDATE edge_authority SET state = 'GRANTED_PENDING', epoch = 3");
    await q("UPDATE edge_authority SET state = 'ACTIVE'");
    await q("UPDATE edge_authority SET state = 'RELEASING'");
    await expect(q("UPDATE edge_authority SET state = 'ACTIVE'")).rejects.toThrow(
      /handover_failed_epoch/,
    );
    await expect(
      q("UPDATE edge_authority SET state = 'ACTIVE', handover_failed_epoch = 2"),
    ).rejects.toThrow(/handover_failed_epoch/);
    await q("UPDATE edge_authority SET state = 'ACTIVE', handover_failed_epoch = 3");
    await expect(q('DELETE FROM edge_authority')).rejects.toThrow();
  });

  it('la table des transitions est figée', async () => {
    await expect(
      q("INSERT INTO edge_authority_transition VALUES ('ARMED', 'RELEASED')"),
    ).rejects.toThrow();
    await expect(q('DELETE FROM edge_authority_transition')).rejects.toThrow();
    await expect(q('TRUNCATE edge_authority_transition')).rejects.toThrow();
  });

  it('edge_audit : chaîné, non modifiable sauf sent_in_batch (une fois)', async () => {
    await q("INSERT INTO edge_audit (kind, actor) VALUES ('A', 'x')");
    await q("INSERT INTO edge_audit (kind, actor) VALUES ('B', 'x')");
    const { rows } = await q('SELECT id, prev_hash, row_hash FROM edge_audit ORDER BY id');
    expect(rows[1].prev_hash.equals(rows[0].row_hash)).toBe(true);
    await expect(q("UPDATE edge_audit SET kind = 'Z'")).rejects.toThrow(/ajout seul/);
    await expect(q('UPDATE edge_audit SET row_hash = $1', [HASH])).rejects.toThrow(/ajout seul/);
    await expect(q('DELETE FROM edge_audit')).rejects.toThrow(/interdit/);
    await expect(q('TRUNCATE edge_audit')).rejects.toThrow(/interdit/);
    await q(
      "UPDATE edge_audit SET sent_in_batch = '00000000-0000-4000-8000-000000000009' WHERE id = $1",
      [rows[0].id],
    );
    await expect(
      q('UPDATE edge_audit SET sent_in_batch = NULL WHERE id = $1', [rows[0].id]),
    ).rejects.toThrow();
  });

  it('edge_clock : le plafond ne décroît jamais', async () => {
    await q("UPDATE edge_clock SET time_floor = '2030-01-01T00:00:00Z'");
    await expect(q("UPDATE edge_clock SET time_floor = '2029-01-01T00:00:00Z'")).rejects.toThrow(
      /décroît/,
    );
    await expect(q('DELETE FROM edge_clock')).rejects.toThrow();
  });

  it('edge_site_order_key : zéro ou exactement deux clés', async () => {
    await expect(q("INSERT INTO edge_site_order_key VALUES ('A', 'k1')")).rejects.toThrow(
      /exactement deux/,
    );
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO edge_site_order_key VALUES ('A', 'k1'), ('B', 'k2')");
      await client.query('COMMIT');
      await expect(q("INSERT INTO edge_site_order_key VALUES ('C', 'k3')")).rejects.toThrow(
        /exactement deux/,
      );
      await expect(q("INSERT INTO edge_site_order_key VALUES ('C', 'k1')")).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it('aucune colonne en clair nommée comme un mot de passe ; colis chiffrés en bytea', async () => {
    const { rows } = await q(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const bad = rows.filter(
      (r: { column_name: string; data_type: string }) =>
        /pwd|pass(word)?|secret|private/i.test(r.column_name) && r.data_type !== 'bytea',
    );
    expect(bad).toEqual([]);
    for (const [table, column] of [
      ['edge_media', 'pwd_pack_enc'],
      ['edge_snapshot_entry', 'pwd_pack_enc'],
    ]) {
      expect(
        rows.find(
          (r: { table_name: string; column_name: string }) =>
            r.table_name === table && r.column_name === column,
        ).data_type,
      ).toBe('bytea');
    }
  });

  it('GatewayTx : transaction READ COMMITTED, annulation sur erreur', async () => {
    const tx = new GatewayTx(db.pool);
    const level = await tx.run(
      async (t) => (await t.query('SHOW transaction_isolation')).rows[0].transaction_isolation,
    );
    expect(level).toBe('read committed');
    await expect(
      tx.run(async (t) => {
        await t.query("INSERT INTO edge_audit (kind) VALUES ('ROLLED_BACK')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await q("SELECT 1 FROM edge_audit WHERE kind = 'ROLLED_BACK'")).rows).toHaveLength(0);
  });
});

describe('migrations : empreinte', () => {
  it('une migration modifiée après avoir été jouée refuse de poursuivre ; relancer sans changement ne fait rien', async () => {
    expect((await applyMigrations(db.pool)).applied).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'edge-mig-'));
    for (const f of readdirSync(MIGRATIONS_DIR))
      copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const file = join(dir, readdirSync(dir).find((f) => f.startsWith('edge-0001'))!);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- modifié\n`);
    await expect(applyMigrations(db.pool, dir)).rejects.toBeInstanceOf(MigrationError);
  });
});
