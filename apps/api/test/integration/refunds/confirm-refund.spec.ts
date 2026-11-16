// Intégration (mission 9a, WP05 ; FR-009, FR-019, FR-020, NFR-001, décision 5) : `confirmRefundRequest`.
import { randomUUID } from 'node:crypto';
import { isAccepted } from '../../../src/ledger/status-matrix';
import { withOwner } from '../../support/db';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import {
  confirm,
  countOfType,
  createRefundWorld,
  createStaff,
  journalCount,
  openRequest,
  paidBalance,
  proposeAndExecute,
  requestState,
  setAuthority,
  unbalanced,
  type RefundWorld,
  type Staff,
} from './refund-flow-fixtures';

jest.setTimeout(300_000);

describe('confirmation du paiement d’un remboursement (confirmRefundRequest)', () => {
  let r: RefundWorld;
  let w: MediaWorld;
  let s: Staff;

  /** Demande `PROCESSING` : proposée par A, exécutée par B (solde payé sorti). */
  const processing = async (funds = 25_000) => {
    const req = await openRequest(w, { funds });
    const done = await proposeAndExecute(r, s.adminA, s.adminB, req.id);
    expect(done.body.status).toBe('EXECUTED');
    return req;
  };

  beforeAll(async () => {
    r = await createRefundWorld();
    w = r.w;
    s = await createStaff(w);
  });
  afterAll(async () => {
    await setAuthority(w.ids.ledgerA, 'CENTRAL');
    await r.app.close();
  });
  afterEach(() => setAuthority(w.ids.ledgerA, 'CENTRAL'));

  it('FR-009 : PAID sans référence (ou d’un espace) : 400 ; PAID : zéro écriture, état PAID', async () => {
    const req = await processing();
    expect((await confirm(r, s.adminC, req.id, { outcome: 'PAID' })).status).toBe(400);
    expect(
      (await confirm(r, s.adminC, req.id, { outcome: 'PAID', external_reference: ' ' })).status,
    ).toBe(400);
    expect((await requestState(req.id)).status).toBe('PROCESSING');
    const before = await journalCount(w.ids.ledgerA);
    const paid = await confirm(r, s.adminC, req.id, {
      outcome: 'PAID',
      external_reference: ' WAVE-TX-1 ',
    });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'PAID', external_reference: 'WAVE-TX-1' });
    expect(contractViolations('RefundRequest', paid.body)).toEqual([]);
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect(await requestState(req.id)).toMatchObject({
      status: 'PAID',
      confirmed_by: s.adminC.userId,
    });
    const audit = await rows<{ action: string }>(
      'SELECT action FROM audit_log WHERE object_id = $1',
      [req.id],
    );
    expect(audit.map((a) => a.action)).toContain('REFUND_REQUEST_PAID');
  });

  it('FR-009 : FAILED sans motif : 400 ; FAILED : REVERSAL, solde payé recrédité, auteur et valideur distincts', async () => {
    const req = await processing(25_000);
    expect(await paidBalance(req.walletId)).toBe(0);
    expect(
      (await confirm(r, s.adminC, req.id, { outcome: 'FAILED', failure_reason: '  ' })).status,
    ).toBe(400);
    const failed = await confirm(r, s.adminC, req.id, {
      outcome: 'FAILED',
      failure_reason: 'Numéro clôturé.',
    });
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: 'FAILED', failure_reason: 'Numéro clôturé.' });
    expect(failed.body.reversal_transaction_id).toEqual(expect.any(String));
    // Le solde payé redevient celui d'avant le remboursement (les frais sont contre-passés aussi).
    expect(await paidBalance(req.walletId)).toBe(25_000);
    const [rev] = await rows<{
      type: string;
      created_by: string;
      approved_by: string;
      reverses_id: string;
    }>('SELECT type, created_by, approved_by, reverses_id FROM journal_transaction WHERE id = $1', [
      failed.body.reversal_transaction_id,
    ]);
    const state = await requestState(req.id);
    expect(rev).toMatchObject({
      type: 'REVERSAL',
      created_by: s.adminC.userId,
      approved_by: s.adminB.userId,
      reverses_id: state.transaction_id,
    });
    expect(await unbalanced(w.ids.ledgerA)).toBe(0);
    // Le festivalier peut refaire une demande (aucune demande ouverte).
    const [open] = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM refund_request WHERE wallet_id = $1
          AND status IN ('AWAITING_HOLDER','REQUESTED','PROCESSING')`,
      [req.walletId],
    );
    expect(open!.n).toBe(0);
  });

  it('décision 13 : FAILED refusé (403) au proposant et à l’exécutant, sans écriture ; PAID leur reste ouvert', async () => {
    const req = await processing();
    const before = await journalCount(w.ids.ledgerA);
    const failed = { outcome: 'FAILED', failure_reason: 'Rejeté.' };
    for (const who of [s.adminA, s.adminB]) {
      const res = await confirm(r, who, req.id, failed);
      expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
    }
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(req.id)).status).toBe('PROCESSING');
    // Une troisième personne : 200 et REVERSAL, valideur = l'exécutant, distinct de l'auteur.
    const ok = await confirm(r, s.orgAdmin, req.id, failed);
    expect(ok.status).toBe(200);
    const [rev] = await rows<{ created_by: string; approved_by: string }>(
      'SELECT created_by, approved_by FROM journal_transaction WHERE id = $1',
      [ok.body.reversal_transaction_id],
    );
    expect(rev).toMatchObject({ created_by: s.orgAdmin.userId, approved_by: s.adminB.userId });
    // PAID : ouvert au proposant comme à l'exécutant.
    for (const who of [s.adminA, s.adminB]) {
      const paying = await processing();
      const paid = await confirm(r, who, paying.id, { outcome: 'PAID', external_reference: 'P-1' });
      expect(paid.status).toBe(200);
    }
  });

  it('confirm sur REQUESTED, PAID ou FAILED : 409 ; rôle SUPERVISOR : 403 ; inconnue : 404', async () => {
    const requested = await openRequest(w);
    const body = { outcome: 'PAID', external_reference: 'X-1' };
    expect((await confirm(r, s.adminC, requested.id, body)).status).toBe(409);
    const req = await processing();
    expect((await confirm(r, w.supervisorA, req.id, body)).status).toBe(403);
    expect((await confirm(r, s.adminC, req.id, body)).status).toBe(200);
    expect((await confirm(r, s.adminC, req.id, body)).status).toBe(409);
    expect(
      (await confirm(r, s.adminC, req.id, { outcome: 'FAILED', failure_reason: 'x' })).status,
    ).toBe(409);
    expect((await confirm(r, s.adminC, randomUUID(), body)).status).toBe(404);
  });

  it('rejeu de la même clé : même réponse, un seul REVERSAL', async () => {
    const req = await processing();
    const key = randomUUID();
    const body = { outcome: 'FAILED', failure_reason: 'Retourné.' };
    const first = await confirm(r, s.adminC, req.id, body, key);
    const again = await confirm(r, s.adminC, req.id, body, key);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotency-replayed']).toBe('true');
  });

  it('NFR-001 : 20 confirm FAILED simultanés (clés distinctes) : un seul REVERSAL', async () => {
    const req = await processing();
    const before = await countOfType(w.ids.ledgerA, 'REVERSAL');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        confirm(r, i % 2 ? s.adminC : s.orgAdmin, req.id, {
          outcome: 'FAILED',
          failure_reason: 'Course.',
        }),
      ),
    );
    expect(results.filter((x) => x.status === 200).length).toBe(1);
    expect(results.filter((x) => x.status === 409).length).toBe(19);
    expect(await countOfType(w.ids.ledgerA, 'REVERSAL')).toBe(before + 1);
    expect(await paidBalance(req.walletId)).toBe(25_000);
  });

  it('FR-019 : FAILED sous EDGE : 409 DEBIT_AUTHORITY_EDGE avant l’écriture ; PAID sous EDGE accepté', async () => {
    const failing = await processing();
    const paying = await processing();
    await setAuthority(w.ids.ledgerA, 'EDGE');
    const before = await journalCount(w.ids.ledgerA);
    const refused = await confirm(r, s.adminC, failing.id, {
      outcome: 'FAILED',
      failure_reason: 'x',
    });
    expect([refused.status, refused.body.code]).toEqual([409, 'DEBIT_AUTHORITY_EDGE']);
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(failing.id)).status).toBe('PROCESSING');
    const paid = await confirm(r, s.adminC, paying.id, {
      outcome: 'PAID',
      external_reference: 'EDGE-1',
    });
    expect(paid.status).toBe(200);
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
  });

  it('corps invalide : champ inconnu, issue inconnue, champ de l’autre issue : 400', async () => {
    const req = await processing();
    for (const body of [
      { outcome: 'LATER' },
      { outcome: 'PAID', external_reference: 'A', extra: 1 },
      { outcome: 'PAID', external_reference: 'A', failure_reason: 'B' },
      {},
    ])
      expect([JSON.stringify(body), (await confirm(r, s.adminC, req.id, body)).status]).toEqual([
        JSON.stringify(body),
        400,
      ]);
  });

  it('décision 5 : FAILED accepté événement en RECONCILING ; la contre-passation d’une vente y reste refusée', async () => {
    const req = await processing();
    // Transitions à sens unique (set_event_status) : ce cas passe en dernier du fichier.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      for (const status of ['CLOSING', 'RECONCILING'])
        await db.query(`SELECT set_event_status($1, $2::event_status, $3)`, [
          w.ids.eventA,
          status,
          w.operatorAdminA.userId,
        ]);
    });
    {
      const [ev] = await rows<{ status: string }>('SELECT status FROM event WHERE id = $1', [
        w.ids.eventA,
      ]);
      expect(ev!.status).toBe('RECONCILING');
      const failed = await confirm(r, s.adminC, req.id, {
        outcome: 'FAILED',
        failure_reason: 'Clôture.',
      });
      expect(failed.status).toBe(200);
      expect(await paidBalance(req.walletId)).toBe(25_000);
      // Le refus d'un REVERSAL de vente dans ce statut est prouvé par la matrice de WP02 (status-matrix).
      expect(
        isAccepted({
          eventStatus: 'RECONCILING',
          ledgerStatus: 'OPEN',
          type: 'REVERSAL',
          source: 'BACKOFFICE',
          reversesType: 'PURCHASE',
        }).ok,
      ).toBe(false);
    }
  });
});
