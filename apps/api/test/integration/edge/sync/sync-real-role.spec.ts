// Réception des lots EDGE_SYNC sous la connexion RÉELLE `cashless_edge`, adaptateurs de production en place (aucun
// faux de port) : tout passe par les fonctions SQL étroites de la migration 0066 (décisions 38 et 39, ADR-174).
// Prouve : le COMMIT d'une écriture comptable (check_balanced DEFINER), les frais recalculés par le central, la preuve
// du bracelet, l'audit, le rejeu, l'ordre des numéros, la clôture exigeant un résultat par numéro, et qu'aucun droit
// direct sur une table n'est rendu à `cashless_edge` (un test qui échoue si un droit revient).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { connect, EDGE_URL } from '../../../support/db';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  makeOp,
  newSigner,
  openOwner,
  seedSite,
  startSyncEdge,
  type Site,
  type SyncEdge,
} from './sync-support';

jest.setTimeout(120_000);

/** Tables, vues et séquences de `public` sur lesquelles `cashless_edge` a un droit direct (hors vue des terminaux). */
const DIRECT_RIGHTS = `
  SELECT c.relname FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND c.relname <> 'edge_device_seq_acked'
     AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass
                        AND e.objid = c.oid AND e.deptype = 'e')
     AND (has_any_column_privilege('cashless_edge', c.oid, 'SELECT')
          OR has_any_column_privilege('cashless_edge', c.oid, 'INSERT')
          OR has_any_column_privilege('cashless_edge', c.oid, 'UPDATE')
          OR has_table_privilege('cashless_edge', c.oid, 'DELETE')
          OR has_table_privilege('cashless_edge', c.oid, 'TRUNCATE')
          OR has_table_privilege('cashless_edge', c.oid, 'REFERENCES')
          OR has_table_privilege('cashless_edge', c.oid, 'TRIGGER')
          OR (c.relkind = 'S' AND has_sequence_privilege('cashless_edge', c.oid, 'USAGE, SELECT, UPDATE')))
   ORDER BY c.relname`;

describe('réception des lots EDGE_SYNC : connexion réelle cashless_edge, accès étroits', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    edge = await startSyncEdge(undefined, undefined, owner);
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  const post = (site: Site, batch: unknown) => edgePost(edge.port, site.cert, batch);
  const lines = async (site: Site, seq: number) =>
    (
      await owner.query(
        `SELECT a.purpose, po.amount, po.fee_rule_id FROM posting po JOIN account a ON a.id = po.account_id
          JOIN journal_transaction t ON t.id = po.transaction_id
          WHERE t.ledger_id = $1 AND t.idempotency_key = $2 ORDER BY po.line_no`,
        [site.ledgerId, `${site.deviceSerial}:${String(seq).padStart(4, '0')}`],
      )
    ).rows as Array<{ purpose: string; amount: bigint; fee_rule_id: string | null }>;
  const rule = async (site: Site, bps: number, version: number): Promise<string> =>
    (
      await owner.query(
        `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
           rate_bps, trigger, valid_from, version)
         VALUES ($1, 'PARTICIPATION', $2, 'MERCHANT', 'ORG_COM', 'SALE_AMOUNT', $3, 'REALTIME',
           now() - interval '1 day', $4) RETURNING id`,
        [site.operatorId, site.participationId, bps, version],
      )
    ).rows[0].id;

  it('aucun droit direct sur une table pour cashless_edge ; un droit rendu est détecté', async () => {
    expect((await owner.query(DIRECT_RIGHTS)).rows).toEqual([]);
    await owner.query('BEGIN');
    try {
      await owner.query('GRANT SELECT ON posting TO cashless_edge');
      expect((await owner.query(DIRECT_RIGHTS)).rows.map((r) => r.relname)).toEqual(['posting']);
    } finally {
      await owner.query('ROLLBACK');
    }
    expect((await owner.query(DIRECT_RIGHTS)).rows).toEqual([]);
    const edgeDb = await connect(EDGE_URL);
    try {
      await expect(edgeDb.query('SELECT 1 FROM posting LIMIT 1')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await edgeDb.end();
    }
  });

  it('une vente est écrite et VALIDÉE au COMMIT (check_balanced DEFINER), preuve du bracelet réelle', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const reply = await post(site, makeBatch(site, [makeOp(site, { amount: 4000 })]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    expect(reply.json?.results[0].effect).toBe('LEDGER_WRITTEN');
    const rows = await lines(site, 1);
    expect(rows.map((r) => r.purpose).sort()).toEqual(['MERCHANT', 'WALLET_PAID']);
    const { rows: cur } = await owner.query(
      'SELECT contiguous_edge_seq FROM edge_gateway WHERE id = $1',
      [site.gatewayId],
    );
    expect(Number(cur[0].contiguous_edge_seq)).toBe(1);
  });

  it('rejeu du même lot : mêmes résultats, aucune écriture de plus', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const batch = makeBatch(site, [makeOp(site, { amount: 1000 })]);
    const first = await post(site, batch);
    const again = await post(site, batch);
    expect(again.status).toBe(200);
    expect(again.json?.results).toEqual(first.json?.results);
    const { rows } = await owner.query(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2',
      [site.ledgerId, `${site.deviceSerial}:0001`],
    );
    expect(rows[0].n).toBe(1);
  });

  it('frais : la passerelle cite la règle la plus généreuse, le central applique la sienne (décision 26)', async () => {
    const site = await seedSite(owner, world, [[1, 100_000]]);
    const good = await rule(site, 200, 1);
    const generous = randomUUID();
    const hostile = makeOp(site, {
      amount: 10_000,
      patch: {
        fee_lines: [{ fee_rule_id: generous, amount: 9000 }],
        fee_rule_id: generous,
        edge_decision: {
          status: 'ACCEPTED',
          charged_to_wallet: 10_000,
          shortfall_amount: 0,
          fee_rule_id: generous,
        },
      },
    });
    const reply = await post(site, makeBatch(site, [hostile]));
    expect(reply.status).toBe(200);
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    const rows = await lines(site, 1);
    const fee = rows.find((r) => r.purpose === 'ORG_COM')!;
    expect(fee.amount).toBe(-200n);
    expect(fee.fee_rule_id).toBe(good);
    expect(rows.some((r) => r.fee_rule_id === generous)).toBe(false);
    expect(rows.reduce((t, r) => t + BigInt(r.amount), 0n)).toBe(0n);
  });

  it('frais : sans règle au central, aucune ligne de frais quoi que dise la passerelle', async () => {
    const site = await seedSite(owner, world, [[1, 100_000]]);
    const reply = await post(
      site,
      makeBatch(site, [makeOp(site, { amount: 5000, patch: { fee_lines: [{ amount: 4999 }] } })]),
    );
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    expect((await lines(site, 1)).map((r) => r.purpose).sort()).toEqual([
      'MERCHANT',
      'WALLET_PAID',
    ]);
  });

  it('frais : une règle expirée ou d’un autre point de vente n’est jamais appliquée', async () => {
    const site = await seedSite(owner, world, [[1, 100_000]]);
    const other = await seedSite(owner, world, [[1, 100_000]]);
    await rule(other, 9000, 1);
    const expired = await rule(site, 5000, 1);
    await owner.query(`UPDATE fee_rule SET valid_to = now() - interval '1 hour' WHERE id = $1`, [
      expired,
    ]);
    const reply = await post(site, makeBatch(site, [makeOp(site, { amount: 5000 })]));
    expect(reply.json?.results[0].status).toBe('ACCEPTED');
    expect((await lines(site, 1)).some((r) => r.purpose === 'ORG_COM')).toBe(false);
  });

  it('preuve du bracelet : signature fausse refusée, signature de la personnalisation acceptée', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const bad = makeOp(site, {
      amount: 1000,
      tapPatch: { originality_signature: Buffer.from('fausse').toString('base64') },
    });
    const badReply = await post(site, makeBatch(site, [bad]));
    expect(badReply.json?.results[0].status).toBe('REJECTED');
    expect(await lines(site, 1)).toEqual([]);
    const ok = await post(site, makeBatch(site, [makeOp(site, { amount: 1000 })]));
    expect(ok.json?.results[0].status).toBe('ACCEPTED');
  });

  it('signature de lot invalide : 400, alerte écrite dans l’audit par la fonction étroite', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const batch = makeBatch(site, [makeOp(site)], { signWith: newSigner(), keepState: true });
    const reply = await post(site, batch);
    expect(reply.status).toBe(400);
    const { rows } = await owner.query(
      `SELECT actor_role, after ->> 'batch_id' AS batch FROM audit_log
        WHERE action = 'EDGE_BATCH_SIGNATURE_INVALID' AND object_id = $1`,
      [site.gatewayId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ actor_role: 'cashless_edge', batch: batch.batch_id });
  });

  it('numéros : un lot qui ne suit pas le registre est refusé (409), rien n’est écrit', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    site.nextEdgeSeq = 5n;
    const reply = await post(site, makeBatch(site, [makeOp(site)]));
    expect(reply.status).toBe(409);
    const { rows } = await owner.query(
      'SELECT count(*)::int AS n FROM edge_sync_batch WHERE gateway_id = $1',
      [site.gatewayId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('clôture DONE refusée tant qu’un numéro n’a pas de résultat (sous cashless_edge)', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const batchId = randomUUID();
    const db = await connect(EDGE_URL);
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.operator_id', $1, true)", [site.operatorId]);
      await db.query("SELECT set_config('app.gateway_id', $1, true)", [site.gatewayId]);
      await db.query('SELECT * FROM edge_sync_batch_begin($1, $2, 1, 1, 2, sha256($3::bytea))', [
        site.gatewayId,
        batchId,
        Buffer.from('x'),
      ]);
      await expect(
        db.query('SELECT edge_sync_batch_finish($1, $2)', [batchId, 'DONE']),
      ).rejects.toMatchObject({ code: 'CL001' });
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
    }
  });

  it('les fonctions étroites refusent une autre passerelle que celle de la session (42501)', async () => {
    const site = await seedSite(owner, world, [[1, 10_000]]);
    const other = await seedSite(owner, world, [[1, 10_000]]);
    const db = await connect(EDGE_URL);
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.operator_id', $1, true)", [site.operatorId]);
      await db.query("SELECT set_config('app.gateway_id', $1, true)", [site.gatewayId]);
      await expect(
        db.query('SELECT * FROM edge_sync_cursor($1)', [other.gatewayId]),
      ).rejects.toMatchObject({ code: '42501' });
      await db.query('ROLLBACK');
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.operator_id', $1, true)", [site.operatorId]);
      await db.query("SELECT set_config('app.gateway_id', $1, true)", [site.gatewayId]);
      await expect(
        db.query('SELECT * FROM edge_sync_device_key($1, $2)', [
          other.gatewayId,
          other.deviceSerial,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await db.query('ROLLBACK');
      // Sa propre passerelle : un terminal d'un autre événement n'est jamais rendu.
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.operator_id', $1, true)", [site.operatorId]);
      await db.query("SELECT set_config('app.gateway_id', $1, true)", [site.gatewayId]);
      const { rows } = await db.query('SELECT * FROM edge_sync_device_key($1, $2)', [
        site.gatewayId,
        other.deviceSerial,
      ]);
      expect(rows).toEqual([]);
      await expect(
        db.query("SELECT edge_sync_audit($1, 'AUTRE', $2, '{}')", [site.gatewayId, randomUUID()]),
      ).rejects.toMatchObject({ code: 'CL001' });
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
    }
  });
});
