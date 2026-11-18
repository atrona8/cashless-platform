// Intégration (mission 9b, WP11 ; FR-019, OP-N126) : le recrédit d'un `FAILED` est borné par le rapprochement bancaire.
// Une ligne de relevé rapprochée à la sortie d'argent prouve que le paiement est visible à la banque : `409`, aucune
// écriture. Sans ligne rapprochée, le comportement de la 9a reste (tiers habilité, `REVERSAL`).
import { withOwner } from '../../support/db';
import { ownerRows as rows } from '../../support/media-fixtures';
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
} from './refund-flow-fixtures';
import { expectRefundInvariants } from './refund-invariants';

jest.setTimeout(300_000);

describe('recrédit d’un FAILED borné par le rapprochement (OP-N126)', () => {
  let r: RefundWorld;
  let s: Staff;
  const failed = { outcome: 'FAILED', failure_reason: 'Paiement non abouti.' };

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  });
  afterAll(async () => {
    await r.app.close();
  });

  /** Demande exécutée (PROCESSING) : sortie d'argent sur `A-PSP-WAVE`. */
  const processing = async () => {
    const req = await openRequest(r.w, { funds: 25_000 });
    expect((await proposeAndExecute(r, s.adminA, s.adminB, req.id)).body.status).toBe('EXECUTED');
    return req;
  };
  /** Ligne de relevé rapprochée à la transaction du remboursement (par `match_statement_line`). */
  const matchStatementLine = async (transactionId: string, ref: string) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [r.w.ops.a]);
      const line = await db.query<{ id: string }>(
        `INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref,
                                              value_date, amount)
         SELECT $1, a.ledger_id, a.id, 'wave', $3, current_date, -24500
           FROM account a WHERE a.ledger_id = $2 AND a.code = 'A-PSP-WAVE'
         RETURNING id::text`,
        [r.w.ops.a, r.w.ids.ledgerA, ref],
      );
      // Chemin réel du rapprochement manuel (WP09) : `match_statement_line`.
      await db.query('SELECT match_statement_line($1::bigint, $2::uuid, NULL, $3::uuid)', [
        line.rows[0]!.id,
        transactionId,
        s.adminA.userId,
      ]);
    });

  it('sans ligne rapprochée : un tiers habilité recrédite (REVERSAL), comme en 9a', async () => {
    const req = await processing();
    const before = await countOfType(r.w.ids.ledgerA, 'REVERSAL');
    const done = await confirm(r, s.adminC, req.id, failed);
    expect(done.status).toBe(200);
    expect(await countOfType(r.w.ids.ledgerA, 'REVERSAL')).toBe(before + 1);
    expect((await requestState(req.id)).status).toBe('FAILED');
    await expectRefundInvariants({ ledgerId: r.w.ids.ledgerA });
  });

  it('avec une ligne de relevé rapprochée à la sortie d’argent : 409, aucune écriture, demande inchangée', async () => {
    const req = await processing();
    const tx = (await requestState(req.id)).transaction_id!;
    await matchStatementLine(tx, `BK-${req.id.slice(0, 8)}`);
    const before = await countOfType(r.w.ids.ledgerA, 'REVERSAL');
    const refused = await confirm(r, s.adminC, req.id, failed);
    expect([refused.status, refused.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(refused.body.detail).toMatch(/relevé/);
    expect(await countOfType(r.w.ids.ledgerA, 'REVERSAL')).toBe(before);
    const state = await requestState(req.id);
    expect([state.status, state.reversal_transaction_id]).toEqual(['PROCESSING', null]);
    // Aucune voie de contournement : le proposant, l'exécutant et l'administrateur de l'organisateur échouent aussi.
    for (const who of [s.adminA, s.adminB])
      expect((await confirm(r, who, req.id, failed)).status).toBe(403);
    expect((await confirm(r, s.orgAdmin, req.id, failed)).status).toBe(409);
    expect(await countOfType(r.w.ids.ledgerA, 'REVERSAL')).toBe(before);
    // Le paiement reste confirmable (PAID) : la borne ne touche que le recrédit.
    const paid = await confirm(r, s.adminC, req.id, {
      outcome: 'PAID',
      external_reference: 'W-OK-1',
    });
    expect([paid.status, paid.body.status]).toEqual([200, 'PAID']);
  });

  it('une ligne rapprochée à une AUTRE transaction ne bloque pas le recrédit', async () => {
    const a = await processing();
    const b = await processing();
    await matchStatementLine((await requestState(b.id)).transaction_id!, `BK-${b.id.slice(0, 8)}`);
    const lines = await rows<{ n: string }>(
      'SELECT count(*)::text AS n FROM external_statement_line WHERE matched_tx_id = $1',
      [(await requestState(a.id)).transaction_id],
    );
    expect(lines[0]!.n).toBe('0');
    expect((await confirm(r, s.adminC, a.id, failed)).status).toBe(200);
  });
});
