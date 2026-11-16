// Limites ACCEPTÉES de la mission 9a (WP07, règle du porteur, CLAUDE.md « dette nommée »). Chaque cas borne une
// limite consignée dans `docs/POINTS_OUVERTS.md` (OP-N124 à OP-N126) et `docs/DECISIONS_ADR.md` (ADR-191 à ADR-193) ; le dernier cas porte le comportement strict de la décision 15 (ADR-194) :
// il passe tant que la limite est exactement celle qui est consignée, et ÉCHOUE si elle s'élargit. Une levée de la
// limite fait aussi échouer le cas : c'est le signal de mettre le test et la consignation à jour ensemble.
import request from 'supertest';
import { OTP_PHONE_MAX } from '../../../src/customer-auth/customer-auth.service';
import { freshPhone, requestOtp } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import { ownerRows as rows } from '../../support/media-fixtures';
import { holderLinkFor } from './refund-invariants';
import { codeFor, fundedCustomer, postRefund } from './create-fixtures';
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

jest.setTimeout(300_000);

describe('limites consignées (OP-N124 à OP-N126) et comportement strict (ADR-194)', () => {
  let r: RefundWorld;
  let s: Staff;

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  });
  afterAll(async () => {
    await r.app.close();
  });

  /** Demande d'un autre numéro, AWAITING_HOLDER, et ce qu'il faut pour décider comme le titulaire. */
  const awaiting = async () => {
    const c = await fundedCustomer(r.w, 10_000);
    const phone = freshPhone();
    const res = await postRefund(r.app, c.customer, {
      wallet_id: c.walletId,
      destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
    });
    expect(res.body.status).toBe('AWAITING_HOLDER');
    const id = res.body.refund_request_id as string;
    const link = holderLinkFor(r.sender, c.phone, id);
    return { c, id, otp: link.otp_request_id, code: link.code };
  };
  const decide = (id: string, body: object) =>
    request(r.app.getHttpServer()).post(`/v1/refund-requests/${id}/holder-decision`).send(body);
  const holderState = async (id: string) =>
    (
      await rows<{ status: string; holder_decision: string | null }>(
        'SELECT status, holder_decision FROM refund_request WHERE id = $1',
        [id],
      )
    )[0]!;

  it('OP-N124 (décision 12a) : le code du titulaire est consommé même si sa décision n’est pas écrite (409) ; un BLOCK perdu laisse la demande passer REQUESTED', async () => {
    const h = await awaiting();
    // La demande est échue avant la décision : la décision est refusée (409) avec un code pourtant valide.
    await withOwner((db) =>
      db.query(
        `UPDATE refund_request SET hold_until = clock_timestamp() - interval '1 minute' WHERE id = $1`,
        [h.id],
      ),
    );
    await withOwner((db) => db.query('SELECT promote_due_refund_requests()'));
    const lost = await decide(h.id, { decision: 'BLOCK', otp_request_id: h.otp, code: h.code });
    expect(lost.status).toBe(409);
    // Limite : le code est consommé, le titulaire ne peut pas réessayer avec lui.
    const retry = await decide(h.id, { decision: 'BLOCK', otp_request_id: h.otp, code: h.code });
    expect([retry.status, retry.body.code]).toEqual([422, 'OTP_INVALID']);
    const [challenge] = await rows<{ consumed: boolean }>(
      'SELECT consumed_at IS NOT NULL AS consumed FROM otp_challenge WHERE id = $1',
      [h.otp.slice(4)],
    );
    expect(challenge!.consumed).toBe(true);
    // Borne : la décision perdue n'est écrite nulle part ; la demande est approuvable sans la décision du titulaire.
    expect(await holderState(h.id)).toEqual({ status: 'REQUESTED', holder_decision: null });
  });

  it('OP-N125 (décision 12b) : le quota de codes par numéro est commun à tous les usages ; le BLOCK du titulaire ne produit qu’une ligne d’audit', async () => {
    const c = await fundedCustomer(r.w, 10_000);
    // Un tiers épuise le quota du numéro du titulaire par des demandes de connexion publiques.
    for (let i = 0; i < OTP_PHONE_MAX; i += 1)
      expect((await requestOtp(r.app, { phone: c.phone, operator_code: r.codeA })).status).toBe(
        202,
      );
    const blockedLogin = await requestOtp(r.app, { phone: c.phone, operator_code: r.codeA });
    expect(blockedLogin.status).toBe(429);
    // Limite : le code du titulaire d'une demande vers un autre numéro n'est plus envoyé (429 à la création).
    const phone = freshPhone();
    const refused = await postRefund(r.app, c.customer, {
      wallet_id: c.walletId,
      destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
    });
    expect(refused.status).toBe(429);
    expect(await rows('SELECT 1 FROM refund_request WHERE wallet_id = $1', [c.walletId])).toEqual(
      [],
    );
    // Alerte de BLOCK : une ligne d'audit sans code ni numéro, aucun autre canal.
    const h = await awaiting();
    const sentBefore = r.sender.sent.length;
    const blocked = await decide(h.id, { decision: 'BLOCK', otp_request_id: h.otp, code: h.code });
    expect(blocked.body.status).toBe('BLOCKED');
    expect(r.sender.sent.length).toBe(sentBefore);
    const audit = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1 AND action = 'REFUND_HOLDER_DECIDED'`,
      [h.id],
    );
    expect(audit[0]!.n).toBe(1);
  });

  it('OP-N126 (décision 13) : FAILED refusé au proposant et à l’exécutant ; UNE seule autre personne habilitée recrédite ; deux administrateurs seuls ne le peuvent pas', async () => {
    const req = await openRequest(r.w, { funds: 25_000 });
    expect((await proposeAndExecute(r, s.adminA, s.adminB, req.id)).body.status).toBe('EXECUTED');
    const failed = { outcome: 'FAILED', failure_reason: 'Paiement non abouti.' };
    // Renforcement : ni le proposant ni l'exécutant.
    for (const who of [s.adminA, s.adminB])
      expect((await confirm(r, who, req.id, failed)).status).toBe(403);
    expect(await countOfType(r.w.ids.ledgerA, 'REVERSAL')).toBe(0);
    // Dette : une seule troisième personne suffit à recréditer (valideur du REVERSAL = l'exécutant, nominal).
    const before = await countOfType(r.w.ids.ledgerA, 'REVERSAL');
    const done = await confirm(r, s.adminC, req.id, failed);
    expect(done.status).toBe(200);
    expect(await countOfType(r.w.ids.ledgerA, 'REVERSAL')).toBe(before + 1);
    const [rev] = await rows<{ created_by: string; approved_by: string }>(
      'SELECT created_by, approved_by FROM journal_transaction WHERE id = $1',
      [done.body.reversal_transaction_id],
    );
    expect(rev).toEqual({ created_by: s.adminC.userId, approved_by: s.adminB.userId });
    expect((await requestState(req.id)).status).toBe('FAILED');
  });

  it('comportement strict (décision 15, ADR-194) : compte sans identité vérifiée : 422 REFUND_NOT_ALLOWED, aucune ligne ; autre numéro : toujours AWAITING_HOLDER', async () => {
    const anon = await fundedCustomer(r.w, 10_000);
    await withOwner((db) =>
      db.query('DELETE FROM customer_identity WHERE customer_id = $1', [anon.customer.customerId]),
    );
    const phone = freshPhone();
    const res = await postRefund(r.app, anon.customer, {
      wallet_id: anon.walletId,
      destination: { method: 'WAVE', msisdn: phone, new_number_otp: await codeFor(r, phone) },
    });
    expect([res.status, res.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    expect(
      await rows('SELECT 1 FROM refund_request WHERE wallet_id = $1', [anon.walletId]),
    ).toEqual([]);
    // Toute création de /me porte une identité : un autre numéro donne toujours AWAITING_HOLDER, jamais REQUESTED.
    const h = await awaiting();
    expect((await holderState(h.id)).status).toBe('AWAITING_HOLDER');
  });
});
