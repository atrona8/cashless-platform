// Levée d'un trou de séquence (mission 7, lot WP20, T083, T086 ; FR-032, FR-033). Route `waiveSeqGap` réelle, deux
// personnes (demande puis `approveApprovalRequest`), vrais lots reçus par `POST /offline-batches` pour fabriquer les
// trous. Chaque test crée son propre terminal : aucune affirmation globale.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { JournalWorld } from './journal-world';
import type { OfflineTerminal } from './processing-fixtures';

jest.setTimeout(240_000);

const voidOp = () => ({
  type: 'VOID',
  occurred_at: new Date().toISOString(),
  void_reason: 'ABORTED_BY_OPERATOR',
});

describe('levée d’un trou de séquence (WP20)', () => {
  let world: JournalWorld;
  beforeAll(async () => {
    world = await JournalWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  /** Terminal avec les numéros 1, 2, 5 et 6 reçus : trous 3 et 4 (anomalies SEQ_GAP ouvertes). */
  async function gapDevice(): Promise<OfflineTerminal> {
    const t = await world.pw.terminal();
    const first = await world.pw.submit(t, [voidOp(), voidOp()]);
    expect(first.status).toBe(200);
    const second = await world.pw.submit(t, [voidOp(), voidOp()], { fromSeq: 5 });
    expect(second.status).toBe(200);
    expect(second.body.missing_seqs).toEqual([3, 4]);
    return t;
  }
  const waivePath = (deviceId: string, seq: string | number) =>
    `/devices/${deviceId}/seq-gaps/${seq}/waive`;
  const REASON = 'Terminal réinitialisé en usine, journal local perdu.';
  const request = (
    deviceId: string,
    seq: string | number,
    who = world.sup1,
    body: unknown = { reason: REASON },
  ) => world.bo('POST', waivePath(deviceId, seq), who, body);
  const registryOf = (deviceId: string) =>
    ownerRows<{
      seq: string;
      outcome: string;
      channel: string;
      transaction_id: string | null;
      created_by: string | null;
      approved_by: string | null;
    }>(
      `SELECT seq::text, outcome, channel, transaction_id, created_by, approved_by
         FROM device_seq_registry WHERE device_id = $1 ORDER BY seq`,
      [deviceId],
    );
  const deviceRow = (deviceId: string) =>
    ownerRows<{ contiguous: string; last_seq: string }>(
      'SELECT contiguous_acked_seq::text AS contiguous, last_seq::text AS last_seq FROM device WHERE id = $1',
      [deviceId],
    ).then((r) => r[0]!);
  const countTx = (deviceId: string) =>
    ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE device_id = $1',
      [deviceId],
    ).then((r) => r[0]!.n);

  it('demande : 202 PENDING, charge utile figée (portée lue en base), audit, rien d’écrit ; rejeu de clé', async () => {
    const t = await gapDevice();
    const before = await registryOf(t.t.deviceId);
    const key = randomUUID();
    const res = await world.bo(
      'POST',
      waivePath(t.t.deviceId, 3),
      world.sup1,
      { reason: REASON },
      key,
    );
    expect(res.status).toBe(202);
    expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      action: 'WAIVE_SEQ_GAP',
      status: 'PENDING',
      target_id: t.t.deviceId,
      requested_by: world.sup1.userId,
    });
    const row = await world.requestRow(res.body.approval_request_id);
    expect(row.payload).toEqual({
      device_id: t.t.deviceId,
      seq: '3',
      reason: REASON,
      scope_type: 'EVENT',
      scope_id: world.w.ids.eventA,
    });
    expect(await registryOf(t.t.deviceId)).toEqual(before);
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'SEQ_GAP_WAIVE_REQUESTED' AND object_id = $1`,
        [t.t.deviceId],
      ),
    ).toHaveLength(1);
    const again = await world.bo(
      'POST',
      waivePath(t.t.deviceId, 3),
      world.sup1,
      { reason: REASON },
      key,
    );
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(again.body).toEqual(res.body);
  });

  it('la même personne n’approuve pas sa propre demande : refus, rien levé', async () => {
    const t = await gapDevice();
    const res = await request(t.t.deviceId, 3);
    const self = await world.approve(res.body.approval_request_id, world.sup1);
    expect(self.status).toBe(409);
    expect((await world.requestRow(res.body.approval_request_id)).status).toBe('PENDING');
    expect((await registryOf(t.t.deviceId)).some((r) => r.outcome === 'WAIVED')).toBe(false);
  });

  it('numéro déjà reçu ou au-delà du dernier vu : 409 SEQ_GAP_NOT_FOUND à la demande, rien créé', async () => {
    const t = await gapDevice();
    const count = () =>
      ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM approval_request WHERE action = 'WAIVE_SEQ_GAP' AND target_id = $1`,
        [t.t.deviceId],
      ).then((r) => r[0]!.n);
    for (const seq of [1, 2, 5, 6, 7, 99]) {
      const res = await request(t.t.deviceId, seq);
      expect([seq, res.status, res.body.code]).toEqual([seq, 409, 'SEQ_GAP_NOT_FOUND']);
    }
    expect(await count()).toBe(0);
  });

  it('numéro couvert par un lot PROCESSING : 409 BATCH_IN_PROGRESS', async () => {
    const t = await gapDevice();
    const batchId = randomUUID();
    await withOwner((db) =>
      db.query(
        `INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes,
                                    prev_chain_hash, last_chain_hash, signature, chain_status)
         VALUES ($1, $2, $3, $4, 3, 4, ARRAY[decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex')],
                 decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'), '\\x00', 'PENDING')`,
        [batchId, world.w.ops.a, t.t.deviceId, world.pw.ledgerId],
      ),
    );
    try {
      const res = await request(t.t.deviceId, 3);
      expect([res.status, res.body.code]).toEqual([409, 'BATCH_IN_PROGRESS']);
    } finally {
      await withOwner((db) =>
        db.query(
          `UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED' WHERE id = $1`,
          [batchId],
        ),
      );
    }
  });

  it('levée complète : registre WAIVED/WAIVER, anomalie RESOLVED, curseur avancé, aucune écriture comptable, audit', async () => {
    const t = await gapDevice();
    const txBefore = await countTx(t.t.deviceId);
    expect((await deviceRow(t.t.deviceId)).contiguous).toBe('2');
    const first = await request(t.t.deviceId, 3);
    const done = await world.approve(first.body.approval_request_id, world.sup2);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    expect(contractViolations('SeqStatus', done.body.result)).toEqual([]);
    expect(done.body.result).toMatchObject({
      device_serial: t.t.serial,
      contiguous_acked_seq: 3,
      max_seen_seq: 6,
      missing_seqs: [4],
    });
    const second = await request(t.t.deviceId, 4);
    const last = await world.approve(second.body.approval_request_id, world.sup3);
    expect(last.body.result).toMatchObject({ contiguous_acked_seq: 6, missing_seqs: [] });
    const waived = (await registryOf(t.t.deviceId)).filter((r) => r.outcome === 'WAIVED');
    expect(waived).toEqual([
      expect.objectContaining({
        seq: '3',
        channel: 'WAIVER',
        transaction_id: null,
        created_by: world.sup1.userId,
        approved_by: world.sup2.userId,
      }),
      expect.objectContaining({
        seq: '4',
        channel: 'WAIVER',
        transaction_id: null,
        created_by: world.sup1.userId,
        approved_by: world.sup3.userId,
      }),
    ]);
    expect(await countTx(t.t.deviceId)).toBe(txBefore);
    const gaps = await world.pw.anomalies(t.t.deviceId, 'SEQ_GAP');
    expect(gaps.map((a) => [a.seq, a.status]).sort()).toEqual([
      ['3', 'RESOLVED'],
      ['4', 'RESOLVED'],
    ]);
    const audit = await ownerRows<{ approver_id: string | null }>(
      `SELECT approver_id FROM audit_log WHERE action = 'SEQ_GAP_WAIVED' AND object_id = $1`,
      [t.t.deviceId],
    );
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.approver_id).sort()).toEqual(
      [world.sup2.userId, world.sup3.userId].sort(),
    );
  });

  it('course : le numéro n’est plus un trou à l’exécution -> demande FAILED, rien levé deux fois', async () => {
    const t = await gapDevice();
    const a = await request(t.t.deviceId, 3);
    const b = await request(t.t.deviceId, 3);
    expect((await world.approve(a.body.approval_request_id, world.sup2)).body.status).toBe(
      'EXECUTED',
    );
    const late = await world.approve(b.body.approval_request_id, world.sup2);
    expect(late.status).toBe(200);
    expect(late.body.status).toBe('FAILED');
    expect((await world.requestRow(b.body.approval_request_id)).failure_code).toBe(
      'SEQ_GAP_NOT_FOUND',
    );
    expect((await registryOf(t.t.deviceId)).filter((r) => r.seq === '3')).toHaveLength(1);
  });

  it('trou hérité (numéro vu sans ligne au registre ni anomalie) : se lève par la même route', async () => {
    const t = await world.pw.terminal();
    expect((await world.pw.submit(t, [voidOp(), voidOp()])).status).toBe(200);
    // Un corps en ligne non objet a pu avancer `last_seq` sans laisser de ligne au registre.
    await withOwner((db) =>
      db.query('UPDATE device SET last_seq = 3 WHERE id = $1', [t.t.deviceId]),
    );
    expect(await world.pw.anomalies(t.t.deviceId, 'SEQ_GAP')).toHaveLength(0);
    const res = await request(t.t.deviceId, 3);
    expect(res.status).toBe(202);
    const done = await world.approve(res.body.approval_request_id, world.sup2);
    expect(done.body.status).toBe('EXECUTED');
    expect(done.body.result).toMatchObject({ contiguous_acked_seq: 3, missing_seqs: [] });
    expect((await registryOf(t.t.deviceId)).at(-1)).toMatchObject({ seq: '3', outcome: 'WAIVED' });
  });

  it('numéro 2^53 : 422 VALIDATION_FAILED ; 2^53 - 1 : accepté par le contrôle de forme (puis 409, pas un trou)', async () => {
    const t = await gapDevice();
    const tooBig = await request(t.t.deviceId, '9007199254740992');
    expect([tooBig.status, tooBig.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    for (const bad of ['0', '-1', '1.5', 'abc', '9007199254740993']) {
      expect([bad, (await request(t.t.deviceId, bad)).status]).toEqual([bad, 422]);
    }
    const max = await request(t.t.deviceId, '9007199254740991');
    expect([max.status, max.body.code]).toEqual([409, 'SEQ_GAP_NOT_FOUND']);
  });

  it('motif court ou champ inconnu : 422 ; autres rôles 403 ; sans jeton 401 ; autre prestataire 404', async () => {
    const t = await gapDevice();
    expect((await request(t.t.deviceId, 3, world.sup1, { reason: 'court' })).status).toBe(422);
    expect(
      (await request(t.t.deviceId, 3, world.sup1, { reason: REASON, scope_id: randomUUID() }))
        .status,
    ).toBe(422);
    expect((await request(t.t.deviceId, 3, world.sup1, {})).status).toBe(422);
    for (const who of [world.w.cashierA, world.w.operatorAdminA, world.w.organizerAdminA])
      expect([who.userId === who.userId, (await request(t.t.deviceId, 3, who)).status]).toEqual([
        true,
        403,
      ]);
    const anonymous = await world.bo(
      'POST',
      waivePath(t.t.deviceId, 3),
      world.sup1,
      { reason: REASON },
      randomUUID(),
      {
        authorization: '',
      },
    );
    expect(anonymous.status).toBe(401);
    const foreign = await request(t.t.deviceId, 3, world.supForeign);
    expect(foreign.status).toBe(404);
    expect((await request(randomUUID(), 3)).status).toBe(404);
    expect((await registryOf(t.t.deviceId)).some((r) => r.outcome === 'WAIVED')).toBe(false);
  });

  it('un approbateur d’un autre prestataire ne peut pas lever (404/403), rien levé', async () => {
    const t = await gapDevice();
    const res = await request(t.t.deviceId, 3);
    const foreign = await world.approve(res.body.approval_request_id, world.supForeign);
    expect([403, 404]).toContain(foreign.status);
    expect((await world.requestRow(res.body.approval_request_id)).status).toBe('PENDING');
    expect((await registryOf(t.t.deviceId)).some((r) => r.outcome === 'WAIVED')).toBe(false);
  });
});
