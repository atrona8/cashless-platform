// Mission 9b, WP14 (T063) : concurrence et invariants de la clôture, vus par ce qui est ÉCRIT (transactions, lignes,
// états), jamais par le nombre de réponses. Quatre blocs :
//   1. NFR-001, étapes de clôture : 50 exécutions simultanées d'une même étape (50 clés), 50 rejeux d'une même clé.
//   2. NFR-001, versements : 50 validations d'un même lot, 50 résultats d'un même versement, 50 rejeux d'une demande.
//   3. SC-002 : versement au-delà du droit net (seul, par cumul de deux lots, après un FAILED recrédité) et lot
//      validé par son auteur : 100 % refusés, aucune écriture.
//   4. Décision 14 (OP-N126) : confirmation FAILED d'une demande de remboursement et rapprochement de sa ligne de
//      relevé sur deux connexions : jamais « recrédit ET rapprochement ». Le test échoue si `match_statement_line`
//      ne verrouille plus `refund_request`.
// Invariants de data-model.md 1 à 4 vérifiés à la fin de chaque bloc.
import { randomUUID } from 'node:crypto';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { createClosingWorld, type ClosingWorld } from '../closing/closing-world';
import { PayoutWorld } from '../payouts/payout-fixtures';
import {
  confirm,
  countOfType,
  createRefundWorld,
  createStaff,
  openRequest,
  proposeAndExecute,
  requestState,
  type RefundWorld,
  type Staff,
} from '../refunds/refund-flow-fixtures';
import { expectRefundInvariants } from '../refunds/refund-invariants';

jest.setTimeout(600_000);

describe('clôture : étapes concurrentes (NFR-001)', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.toSettling();
  });
  afterAll(async () => w.close());

  const unbalanced = () =>
    w.owner(
      `SELECT transaction_id FROM posting WHERE ledger_id = $1 GROUP BY transaction_id HAVING sum(amount) <> 0`,
      [w.fx.ledgerId],
    );

  it('50 exécutions simultanées de la même étape (50 clés) : une seule série d’écritures, aucun 500', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => w.post('/closing-steps/PITCH_FEES')),
    );
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    expect(results.filter((r) => r.status !== 200)).toEqual([]);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await w.counts()).closing).toBe(1);
  });

  it('50 rejeux d’une même clé sur l’étape suivante : une seule écriture de plus', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => w.post('/closing-steps/OPERATOR_FEE', undefined, key)),
    );
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
    expect((await w.counts()).closing).toBe(2);
  });

  it('invariant 1 : une étape au plus une fois par événement ; grand livre équilibré', async () => {
    const rows = await w.owner<{ step: string; n: number }>(
      `SELECT step, count(*)::int AS n FROM closing_step WHERE event_id = $1 GROUP BY step`,
      [w.fx.eventId],
    );
    expect(rows.every((r) => r.n === 1)).toBe(true);
    expect(rows.map((r) => r.step).sort()).toEqual(['OPERATOR_FEE', 'PITCH_FEES']);
    expect(await unbalanced()).toEqual([]);
  });
});

describe('versements : concurrence (NFR-001) et refus (SC-002)', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 300_000);
  afterAll(async () => {
    await p.close();
  });
  afterEach(async () => {
    expect(await p.unbalanced()).toBe(0);
  });

  it('NFR-001 : 50 validations simultanées d’un même lot : une transaction PAYOUT_INITIATED, un jeu de lignes', async () => {
    const m1 = await p.merchant(20_000);
    const m2 = await p.merchant(20_000);
    const asked = await p.request([p.line(m1, 5_000), p.line(m2, 7_000)]);
    const id = String(asked.body.approval_request_id);
    const before = await p.txCount('PAYOUT_INITIATED');
    const all = await Promise.all(Array.from({ length: 50 }, () => p.approve(id)));
    expect(all.filter((r) => r.status >= 500)).toEqual([]);
    expect(all.filter((r) => r.status === 200 && r.body.status === 'EXECUTED')).toHaveLength(1);
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(before + 1);
    expect(await p.payoutsOf(id)).toHaveLength(2);
    expect([await p.net(m1.partyId), await p.net(m2.partyId)]).toEqual([15_000, 13_000]);
  });

  it('NFR-001 : 50 résultats simultanés d’un même versement : un seul PAYOUT_CONFIRMED, un seul changement d’état (invariant 3)', async () => {
    const m = await p.merchant(10_000);
    const { id } = await p.batch([p.line(m, 4_000)]);
    const payout = (await p.payoutsOf(id))[0]!.id;
    const before = await p.txCount('PAYOUT_CONFIRMED');
    const all = await Promise.all(
      Array.from({ length: 50 }, () =>
        p.bo('POST', `/payouts/${payout}/confirm`, p.w.organizerAdminA, {
          outcome: 'CONFIRMED',
          external_reference: 'REF-W14',
        }),
      ),
    );
    expect(all.filter((r) => r.status !== 200)).toEqual([]);
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(before + 1);
    // Un résultat contraire après coup : refusé, état et écritures inchangés.
    const late = await p.bo('POST', `/payouts/${payout}/confirm`, p.organizerAdmin2, {
      outcome: 'FAILED',
      failure_reason: 'tardif',
    });
    expect(late.status).toBe(409);
    expect((await p.payoutsOf(id))[0]!.status).toBe('CONFIRMED');
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(before + 1);
    expect(await p.net(m.partyId)).toBe(6_000);
  });

  it('NFR-001 : 50 rejeux de la même clé de demande : une seule demande', async () => {
    const m = await p.merchant(5_000);
    const key = randomUUID();
    const lines = [p.line(m, 100)];
    const all = await Promise.all(
      Array.from({ length: 50 }, () => p.request(lines, p.w.organizerAdminA, key)),
    );
    expect(all.filter((r) => r.status >= 500)).toEqual([]);
    const rows = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval_request WHERE action = 'PAYOUT' AND payload @> $1::jsonb`,
      [JSON.stringify({ lines: [{ beneficiary_party_id: m.partyId }] })],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('SC-002 : au-delà du droit net, seul, par cumul de deux lots, après un FAILED recrédité, ou par son auteur : 100 % refusés, aucune écriture', async () => {
    let attempts = 0;
    let refused = 0;
    const initiatedBefore = await p.txCount('PAYOUT_INITIATED');
    const settledBefore = await p.txCount('PAYOUT_CONFIRMED');
    let legit = 0;

    // (a) seul : un franc au-dessus du droit net, dix commerçants.
    for (let i = 0; i < 10; i++) {
      const m = await p.merchant(10_000 + i);
      attempts++;
      const res = await p.request([p.line(m, 10_001 + i)]);
      if (res.status === 409 && res.body.code === 'PAYOUT_EXCEEDS_ENTITLEMENT') refused++;
    }

    // (b) cumul : deux lots demandés chacun dans la limite, validés en parallèle ; le second est refusé à la validation.
    for (let i = 0; i < 5; i++) {
      const m = await p.merchant(10_000);
      const a = await p.request([p.line(m, 6_000)]);
      const b = await p.request([p.line(m, 5_000)]);
      expect([a.status, b.status]).toEqual([202, 202]);
      const [ra, rb] = await Promise.all([
        p.approve(a.body.approval_request_id, p.organizerAdmin2),
        p.approve(b.body.approval_request_id, p.organizerAdmin2),
      ]);
      const outcomes = [ra.body.status, rb.body.status].sort();
      expect(outcomes).toEqual(['EXECUTED', 'FAILED']);
      legit++;
      attempts++;
      const failed = ra.body.status === 'FAILED' ? ra : rb;
      if (failed.body.failure_code === 'PAYOUT_EXCEEDS_ENTITLEMENT') refused++;
      // Le droit net ne devient jamais négatif : l'un des deux lots seulement est sorti.
      expect([4_000, 5_000]).toContain(await p.net(m.partyId));
    }

    // (c) après un FAILED recrédité : le droit revient à sa valeur, pas au-delà.
    for (let i = 0; i < 5; i++) {
      const m = await p.merchant(10_000);
      const { id } = await p.batch([p.line(m, 10_000)]);
      legit++;
      const payout = (await p.payoutsOf(id))[0]!.id;
      const failedRes = await p.bo('POST', `/payouts/${payout}/confirm`, p.w.organizerAdminA, {
        outcome: 'FAILED',
        failure_reason: 'échec réseau',
      });
      expect(failedRes.status).toBe(200);
      expect(await p.net(m.partyId)).toBe(10_000);
      attempts++;
      const over = await p.request([p.line(m, 10_001)]);
      if (over.status === 409 && over.body.code === 'PAYOUT_EXCEEDS_ENTITLEMENT') refused++;
      // Le recrédit n'a rien ouvert de plus : un nouveau lot exact passe, le suivant est refusé.
      const again = await p.batch([p.line(m, 10_000)]);
      legit++;
      expect(again.approved.body.status).toBe('EXECUTED');
      attempts++;
      const extra = await p.request([p.line(m, 1)]);
      if (extra.status === 409 && extra.body.code === 'PAYOUT_EXCEEDS_ENTITLEMENT') refused++;
    }

    // (d) lot validé par son auteur : refusé, rien d'écrit.
    for (let i = 0; i < 5; i++) {
      const m = await p.merchant(3_000);
      const asked = await p.request([p.line(m, 1_000)]);
      attempts++;
      const self = await p.approve(asked.body.approval_request_id, p.w.organizerAdminA);
      if ([403, 409].includes(self.status) && self.body.status !== 'EXECUTED') refused++;
      expect(await p.payoutsOf(String(asked.body.approval_request_id))).toHaveLength(0);
      expect(await p.net(m.partyId)).toBe(3_000);
    }

    expect({ attempts, refused }).toEqual({ attempts, refused: attempts });
    // Seules les écritures légitimes existent : (b) un lot par cas, (c) deux lots par cas.
    expect(await p.txCount('PAYOUT_INITIATED')).toBe(initiatedBefore + legit);
    expect(await p.txCount('PAYOUT_CONFIRMED')).toBe(settledBefore);
  });

  it('invariant 2 : les versements INITIATED n’ont jamais fait passer un droit net sous zéro', async () => {
    // Le droit net courant (`party_position`) est déjà diminué des versements en cours : jamais négatif.
    const negative = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM party_position WHERE ledger_id = $1 AND net_claim < 0`,
      [p.ledger],
    );
    expect(negative[0]!.n).toBe(0);
  });
});

describe('décision 14 (OP-N126) : recrédit d’un FAILED et rapprochement de sa ligne, deux connexions', () => {
  let r: RefundWorld;
  let s: Staff;
  const failed = { outcome: 'FAILED', failure_reason: 'Paiement non abouti.' };

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  }, 300_000);
  afterAll(async () => {
    await r.app.close();
  });

  const processing = async () => {
    const req = await openRequest(r.w, { funds: 25_000 });
    expect((await proposeAndExecute(r, s.adminA, s.adminB, req.id)).body.status).toBe('EXECUTED');
    return { ...req, tx: (await requestState(req.id)).transaction_id! };
  };
  /** Ligne de relevé non rapprochée, de référence `ref`, sur le compte de sortie d'argent. */
  const statementLine = (ref: string) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [r.w.ops.a]);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref, value_date, amount)
         SELECT $1, a.ledger_id, a.id, 'wave', $3, current_date, -24500
           FROM account a WHERE a.ledger_id = $2 AND a.code = 'A-PSP-WAVE' RETURNING id::text`,
        [r.w.ops.a, r.w.ids.ledgerA, ref],
      );
      return rows[0]!.id;
    });
  const match = (line: string, tx: string) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [r.w.ops.a]);
      return db
        .query('SELECT match_statement_line($1::bigint, $2::uuid, NULL, $3::uuid)', [
          line,
          tx,
          s.adminA.userId,
        ])
        .then(
          () => ({ ok: true as const, code: '' }),
          (e: { code?: string }) => ({ ok: false as const, code: e.code ?? '?' }),
        );
    });
  const lineState = async (line: string) =>
    (
      await ownerRows<{ matched_tx_id: string | null }>(
        'SELECT matched_tx_id FROM external_statement_line WHERE id = $1::bigint',
        [line],
      )
    )[0]!;

  it('déterministe : un recrédit FAILED validé pendant que le rapprochement attend le verrou de la demande : rapprochement refusé (CL043), ligne non rapprochée', async () => {
    const req = await processing();
    const line = await statementLine(`BK-${req.id.slice(0, 8)}`);
    // La confirmation FAILED tient le verrou de la demande (écriture non validée) ; le rapprochement arrive ensuite.
    const outcome = await commitWhileWaiting(
      {
        sql: `UPDATE refund_request SET status = 'FAILED', failure_reason = 'test', reversal_transaction_id = transaction_id,
                     confirmed_by = approved_by, confirmed_at = clock_timestamp() WHERE id = $1 AND status = 'PROCESSING'`,
        params: [req.id],
      },
      { role: 'postgres', statement: 'match_statement_line' },
      () => match(line, req.tx),
    );
    expect(outcome).toEqual({ ok: false, code: 'CL043' });
    expect((await lineState(line)).matched_tx_id).toBeNull();
    expect((await requestState(req.id)).status).toBe('FAILED');
  });

  it('course réelle : 8 demandes, confirmation FAILED (HTTP) et rapprochement lancés ensemble : jamais recrédit ET rapprochement', async () => {
    const results: string[] = [];
    for (let i = 0; i < 8; i++) {
      const req = await processing();
      const line = await statementLine(`BK-${req.id.slice(0, 8)}`);
      const reversalsBefore = await countOfType(r.w.ids.ledgerA, 'REVERSAL');
      const [conf, matched] = await Promise.all([
        confirm(r, s.adminC, req.id, failed),
        match(line, req.tx),
      ]);
      const state = await requestState(req.id);
      const isMatched = (await lineState(line)).matched_tx_id !== null;
      const reversals = (await countOfType(r.w.ids.ledgerA, 'REVERSAL')) - reversalsBefore;
      // Jamais les deux ensemble.
      expect(state.status === 'FAILED' && isMatched).toBe(false);
      if (state.status === 'FAILED') {
        expect([conf.status, reversals, matched.ok]).toEqual([200, 1, false]);
        results.push('recrédité');
      } else {
        // Le rapprochement a gagné : recrédit refusé (409), aucune contre-passation.
        expect([state.status, conf.status, reversals, isMatched]).toEqual([
          'PROCESSING',
          409,
          0,
          true,
        ]);
        results.push('rapproché');
      }
    }
    expect(results).toHaveLength(8);
    await expectRefundInvariants({ ledgerId: r.w.ids.ledgerA });
  });

  it('invariant 4 : une ligne rapprochée au plus une fois, même sous 10 rapprochements simultanés', async () => {
    const req = await processing();
    const line = await statementLine(`BK-${req.id.slice(0, 8)}`);
    const all = await Promise.all(Array.from({ length: 10 }, () => match(line, req.tx)));
    expect(all.filter((x) => x.ok)).toHaveLength(1);
    expect(all.filter((x) => !x.ok).every((x) => x.code === 'CL043')).toBe(true);
    expect((await lineState(line)).matched_tx_id).toBe(req.tx);
  });
});
