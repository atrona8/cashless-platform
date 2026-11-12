// T091 : application des résultats du central, purge des deltas, accusés, audit de tolérance.
import { randomUUID } from 'node:crypto';
import { resultOnlyDeltaPurge } from '../../src/queue/result-applier';
import {
  acceptAll,
  auditKinds,
  DEVICE_ID,
  head,
  makeQueueHarness,
  ops,
  purchase,
  SERIAL,
  type QueueHarness,
} from './_support/queue-harness';

const W1 = 'a0000000-0000-4000-8000-000000000001';
const W2 = 'a0000000-0000-4000-8000-000000000002';

jest.setTimeout(30_000);

let h: QueueHarness;
beforeEach(async () => {
  h = await makeQueueHarness();
});
afterEach(async () => {
  await h.close();
});

const key = (seq: number): string => `${SERIAL}:${seq}`;
const status = async (): Promise<string[]> => (await ops(h.db)).map((o) => o.central_status);

describe('clé d’idempotence rendue par le central', () => {
  it('clé rendue identique à celle de la file (`<serial>:<seq>`) : rapprochée', async () => {
    await h.add(3);
    h.central.script = (request) => acceptAll(request, {});
    await h.drain.runOnce();
    expect(await status()).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(await auditKinds(h.db)).not.toContain('DRAIN_RESULT_UNKNOWN_OP');
  });
  it('zéros de tête différents (décision 52, plus de rapprochement approché) : opération inconnue', async () => {
    await h.add(1);
    h.central.script = (request) =>
      acceptAll(request, { [key(1)]: (r) => ({ ...r, idempotency_key: `${SERIAL}:0001` }) });
    await h.drain.runOnce();
    expect(await status()).toEqual(['SENT']);
    expect(await auditKinds(h.db)).toContain('DRAIN_RESULT_UNKNOWN_OP');
  });
  it('un autre numéro ou un autre terminal reste une opération inconnue', async () => {
    await h.add(1);
    h.central.script = (request) =>
      acceptAll(request, {
        [key(1)]: (r) => ({ ...r, idempotency_key: `${SERIAL}:0002` }),
      });
    await h.drain.runOnce();
    expect(await status()).toEqual(['SENT']);
  });
});

describe('issues du central et leur effet', () => {
  it('chaque issue est enregistrée, la purge est appelée avec le bon numéro et la bonne issue', async () => {
    await h.add(5);
    h.central.script = (request) =>
      acceptAll(request, {
        [key(2)]: (r) => ({ ...r, status: 'ACCEPTED_WITH_SHORTFALL', shortfall_amount: 40 }),
        [key(3)]: (r) => ({ ...r, status: 'DUPLICATE' }),
        [key(4)]: (r) => ({
          ...r,
          status: 'REJECTED',
          reject_reason: 'MALFORMED_OPERATION',
          transaction_id: null,
          effect: 'NONE',
          detail: 'tap absent',
        }),
        [key(5)]: (r) => ({ ...r, status: 'REJECTED', reject_reason: 'X', effect: 'NONE' }),
      });
    await h.drain.runOnce();
    expect(await status()).toEqual([
      'ACCEPTED',
      'ACCEPTED_WITH_SHORTFALL',
      'DUPLICATE',
      'REJECTED',
      'REJECTED',
    ]);
    expect(h.purge.calls).toEqual([
      { edgeSeq: 1, status: 'ACCEPTED' },
      { edgeSeq: 2, status: 'ACCEPTED_WITH_SHORTFALL' },
      { edgeSeq: 3, status: 'DUPLICATE' },
      { edgeSeq: 4, status: 'REJECTED' },
      { edgeSeq: 5, status: 'REJECTED' },
    ]);
    const rows = await ops(h.db);
    expect(rows[3]!.central_reason).toBe('MALFORMED_OPERATION');
    expect(rows[3]!.central_detail.detail).toBe('tap absent');
    expect(rows[0]!.central_transaction_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows.every((r) => r.sent_batch_id === rows[0]!.sent_batch_id)).toBe(true);
    const state = await head(h.db);
    expect([
      state.acked_edge_seq,
      Buffer.from(state.acked_chain_hash).equals(rows[4]!.chain_hash),
    ]).toEqual(['5', true]);
    expect(h.drained).toBe(1);
  });

  it('un VOID consomme son numéro et se range VOID', async () => {
    await h.addOp(purchase(1));
    await h.addOp({
      ...purchase(2),
      type: 'VOID',
      operation: { seq: 2, type: 'VOID', occurred_at: '2026-12-12T08:02:00Z', void_reason: 'X' },
    });
    h.central.script = (request) =>
      acceptAll(request, { [key(2)]: (r) => ({ ...r, effect: 'NONE', transaction_id: null }) });
    await h.drain.runOnce();
    expect(await status()).toEqual(['ACCEPTED', 'VOID']);
    expect(h.purge.calls[1]).toEqual({ edgeSeq: 2, status: 'VOID' });
  });

  it('la purge porte sur le bon portefeuille : REJECTED annule ses deltas, ACCEPTED garde les siens', async () => {
    const real = await makeQueueHarness({ purge: resultOnlyDeltaPurge });
    try {
      await real.addOp(purchase(1), [{ walletId: W1, paidDelta: -100n, promoDelta: 0n }]);
      await real.addOp(purchase(2), [{ walletId: W2, paidDelta: -50n, promoDelta: -10n }]);
      real.central.script = (request) =>
        acceptAll(request, {
          [key(1)]: (r) => ({ ...r, status: 'REJECTED', effect: 'NONE', transaction_id: null }),
        });
      await real.drain.runOnce();
      const { rows } = await real.db.pool.query('SELECT edge_seq, wallet_id FROM edge_op_delta');
      expect(rows).toEqual([{ edge_seq: '2', wallet_id: W2 }]);
    } finally {
      await real.close();
    }
  });

  it('résultat pour une clé inconnue : alerte, aucune écriture', async () => {
    await h.add(2);
    h.central.script = (request) => {
      const reply = acceptAll(request);
      (reply.body as any).results.push({
        seq: 77,
        idempotency_key: 'TPE-INCONNU:77',
        status: 'ACCEPTED',
        effect: 'LEDGER_WRITTEN',
        retryable: false,
      });
      return reply;
    };
    await h.drain.runOnce();
    expect(await status()).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(await auditKinds(h.db)).toContain('DRAIN_RESULT_UNKNOWN_OP');
    expect(h.purge.calls).toHaveLength(2);
  });

  it('issue contradictoire pour une opération déjà ACCEPTED : alerte, rien n’est réécrit', async () => {
    await h.add(1);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const before = (await ops(h.db))[0]!;
    // Second cycle : un lot hors file (hint) fait répondre REJECTED pour l'opération déjà ACCEPTED.
    h.drain.requestDrain({ missingEdgeSeqs: [1] });
    h.central.script = (request) =>
      acceptAll(request, { [key(1)]: (r) => ({ ...r, status: 'REJECTED', effect: 'NONE' }) });
    await h.drain.runOnce();
    const after = (await ops(h.db))[0]!;
    expect(after.central_status).toBe('ACCEPTED');
    expect(after.central_transaction_id).toBe(before.central_transaction_id);
    expect(await auditKinds(h.db)).toContain('DRAIN_RESULT_CONFLICT');
    // DUPLICATE d'une opération déjà ACCEPTED : compatible, pas d'alerte de plus.
    const conflicts = (await auditKinds(h.db)).filter((k) => k === 'DRAIN_RESULT_CONFLICT').length;
    h.drain.requestDrain({ missingEdgeSeqs: [1] });
    h.central.script = (request) =>
      acceptAll(request, { [key(1)]: (r) => ({ ...r, status: 'DUPLICATE' }) });
    await h.drain.runOnce();
    expect((await auditKinds(h.db)).filter((k) => k === 'DRAIN_RESULT_CONFLICT').length).toBe(
      conflicts,
    );
    expect((await ops(h.db))[0]!.central_status).toBe('ACCEPTED');
  });

  it('réponse mal formée (autre batch_id) : rien n’est appliqué, le lot reste en vol', async () => {
    await h.add(2);
    h.central.script = (request) => {
      const reply = acceptAll(request);
      (reply.body as any).batch_id = randomUUID();
      return reply;
    };
    await h.drain.runOnce();
    expect(await status()).toEqual(['SENT', 'SENT']);
    expect(await auditKinds(h.db)).toContain('DRAIN_RESULT_MALFORMED');
    expect((await head(h.db)).acked_edge_seq).toBe('0');
  });

  it('seul le contenu des champs central_* change : le contenu d’une opération reste intact', async () => {
    await h.add(1);
    const before = (await ops(h.db))[0]!;
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const after = (await ops(h.db))[0]!;
    expect(after.operation).toEqual(before.operation);
    expect(after.content_sha256).toEqual(before.content_sha256);
    expect(after.chain_hash).toEqual(before.chain_hash);
  });
});

describe('accusés des terminaux', () => {
  it('viennent des résultats du central, jamais de la file locale', async () => {
    await h.add(3);
    await h.db.pool.query(
      'INSERT INTO edge_device_seq (device_id, contiguous_local_seq) VALUES ($1, 3)',
      [DEVICE_ID],
    );
    // Trois opérations locales, aucune réponse du central : l'accusé reste à zéro.
    h.central.script = () => ({ destroy: true });
    await h.drain.runOnce();
    let row = (await h.db.pool.query('SELECT * FROM edge_device_seq')).rows[0];
    expect([row.central_acked_seq, row.acked_known]).toEqual(['0', false]);
    // Le central répond pour les opérations 1 et 2 seulement (lot abandonné) : accusé 2.
    h.central.script = (request) => {
      const reply = acceptAll(request, {}, { abandoned: true });
      (reply.body as any).results = (reply.body as any).results.slice(0, 2);
      return reply;
    };
    await h.drain.runOnce();
    row = (await h.db.pool.query('SELECT * FROM edge_device_seq')).rows[0];
    expect([row.central_acked_seq, row.acked_known]).toEqual(['2', true]);
    expect(row.central_acked_at).not.toBeNull();
    expect(row.contiguous_local_seq).toBe('3');
  });

  it('un terminal inconnu de edge_device_seq reçoit sa ligne depuis les résultats', async () => {
    await h.add(2);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const row = (await h.db.pool.query('SELECT * FROM edge_device_seq')).rows[0];
    expect(row.central_acked_seq).toBe('2');
  });
});

describe('staff_token_audit', () => {
  const tolerated = (edgeSeq: number, jti: string, extra: Record<string, unknown> = {}) =>
    h.db.pool.query(
      `INSERT INTO edge_audit (kind, actor, edge_seq, detail)
       VALUES ('STAFF_TOKEN_TOLERATED', 'staff', $1, $2)`,
      [
        edgeSeq,
        JSON.stringify({
          sub: 'user-1',
          iss: 'https://id.example',
          jti,
          seconds_past_expiry: 90,
          route: 'takeDeposit',
          device_serial: SERIAL,
          ...extra,
        }),
      ],
    );

  it('joint au lot ; sent_in_batch posé seulement quand le lot est DONE', async () => {
    await h.add(3);
    await tolerated(2, 'jti-2');
    h.central.script = () => ({ destroy: true });
    await h.drain.runOnce();
    const sent = h.central.requests[0]!.body as any;
    expect(sent.staff_token_audit).toHaveLength(1);
    expect(sent.staff_token_audit[0]).toMatchObject({
      edge_seq: 2,
      subject: 'user-1',
      issuer: 'https://id.example',
      jti: 'jti-2',
      seconds_past_expiry: 90,
      route: 'takeDeposit',
      device_serial: SERIAL,
    });
    const pending = async () =>
      (
        await h.db.pool.query(
          "SELECT sent_in_batch FROM edge_audit WHERE kind = 'STAFF_TOKEN_TOLERATED'",
        )
      ).rows[0].sent_in_batch;
    expect(await pending()).toBeNull(); // envoyé, pas encore DONE
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    expect(await pending()).toBe(sent.batch_id);
    // Le lot suivant ne le porte plus.
    await h.add(1);
    await h.drain.runOnce();
    expect((h.central.requests.at(-1)!.body as any).staff_token_audit).toBeUndefined();
  });

  it('une ligne sans forme valide n’est pas versée (le lot serait refusé) : alerte, la ligne locale reste', async () => {
    await h.add(1);
    await tolerated(1, 'jti-1', { route: 'autre' });
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    expect((h.central.requests[0]!.body as any).staff_token_audit).toBeUndefined();
    expect(await auditKinds(h.db)).toContain('STAFF_AUDIT_UNSENDABLE');
    expect(
      (
        await h.db.pool.query(
          "SELECT sent_in_batch FROM edge_audit WHERE kind = 'STAFF_TOKEN_TOLERATED'",
        )
      ).rows[0].sent_in_batch,
    ).toBeNull();
  });

  it('un lot abandonné ne verse que les lignes des opérations résolues', async () => {
    await h.add(3);
    await tolerated(1, 'jti-1');
    await tolerated(3, 'jti-3');
    h.central.script = (request) => {
      const reply = acceptAll(request, {}, { abandoned: true });
      (reply.body as any).results = (reply.body as any).results.slice(0, 2);
      return reply;
    };
    await h.drain.runOnce();
    const rows = (
      await h.db.pool.query(
        "SELECT edge_seq, sent_in_batch FROM edge_audit WHERE kind = 'STAFF_TOKEN_TOLERATED' ORDER BY id",
      )
    ).rows;
    expect(rows[0].sent_in_batch).not.toBeNull();
    expect(rows[1].sent_in_batch).toBeNull(); // repart dans le lot suivant
  });
});

describe('rendu final', () => {
  it('file vide et acked à jour : résumé du rendu ; sinon rien', async () => {
    expect(await h.drain.finalSummary()).toEqual({
      final_edge_seq: 0,
      last_chain_hash: Buffer.from((await head(h.db)).last_chain_hash).toString('hex'),
    });
    await h.add(2);
    expect(await h.drain.finalSummary()).toBeNull();
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const state = await head(h.db);
    expect(await h.drain.finalSummary()).toEqual({
      final_edge_seq: 2,
      last_chain_hash: Buffer.from(state.last_chain_hash).toString('hex'),
    });
  });

  it('notifyQueueDrained : le signal part quand la file devient vide, et quand le vidage était demandé', async () => {
    await h.add(1);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    expect(h.drained).toBe(1);
    await h.drain.runOnce(); // rien de nouveau : pas de bruit
    expect(h.drained).toBe(1);
    h.drain.requestDrain();
    await h.drain.runOnce(); // vidage demandé, file déjà vide
    expect(h.drained).toBe(2);
  });
});
