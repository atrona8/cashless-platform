// Intégration : contestation tardive `LATE_CHARGEBACK` (mission 6, lot WP13, T066 et T068 ; FR-027 ; ADR-74, ADR-77 ;
// SPECIFICATION §12.1). Réception sur grand livre LOCKED : rien au grand livre, anomalie, contestation `late`. Écriture :
// deux personnes du back-office, source BACKOFFICE, même clé que la voie normale.
import { randomUUID } from 'node:crypto';
import { LATE_CHARGEBACK_ROLES } from '../../../src/chargebacks/late-chargeback-action';
import { ownerRows } from '../../support/media-fixtures';
import { ChargebackWorld, type Credited } from './chargeback-fixtures';

jest.setTimeout(120_000);

describe('contestation tardive', () => {
  let c: ChargebackWorld;
  beforeAll(async () => {
    c = await ChargebackWorld.create();
  }, 240_000);
  afterEach(async () => {
    await c.unlockLedger();
  });
  afterAll(async () => {
    await c.close();
  });

  const author = () => c.cw.w.operatorAdminA;
  const validator = () => c.cw.w.organizerAdminA;
  const ask = (chargebackId: string, who = author(), body: unknown = {}, key = randomUUID()) =>
    c.cw.bo('POST', `/chargebacks/${chargebackId}/approval-requests`, who, body, key);
  const approve = (id: unknown, who = validator()) =>
    c.cw.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});
  const anomalyOf = (id: string | null) =>
    ownerRows<{ kind: string; status: string; amount: string; resolution_tx_id: string | null }>(
      'SELECT kind, status, amount::text, resolution_tx_id FROM anomaly WHERE id = $1',
      [id],
    ).then((r) => r[0]!);
  const lateAnomalies = () =>
    ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM anomaly WHERE ledger_id = $1 AND kind = 'LATE_CHARGEBACK'`,
      [c.p.ev.ledgerId],
    ).then((r) => r[0]!.n);

  /** Recharge créditée, puis grand livre verrouillé, puis contestation reçue. */
  async function received(amount = 4_000, spend = 0) {
    const t: Credited = await c.credited({ amount: 10_000 });
    if (spend > 0) await c.spend(t.walletId, spend);
    await c.lockLedger();
    const dispute = c.disputeId();
    const out = await c.handle(t.row, c.notification(t.row, dispute, amount));
    const [cb] = await c.chargebacks(t.row.topupId);
    return { t, dispute, out, cb: cb! };
  }

  it('les rôles de la demande sont bornés : ORGANIZER_ADMIN et OPERATOR_ADMIN, aucun autre', () => {
    expect([...LATE_CHARGEBACK_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('réception sur LOCKED : 0 transaction, 1 anomalie LATE_CHARGEBACK, 1 contestation late ; rejeu : inchangé', async () => {
    const before = await lateAnomalies();
    const { t, dispute, out, cb } = await received(4_000);
    expect(out).toMatchObject({ disposition: 'PROCESSED', outcome: 'CHARGEBACK' });
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
    expect(cb).toMatchObject({ late: true, chargeback_tx_id: null, wallet_blocked: false });
    expect(await anomalyOf(cb.anomaly_id)).toMatchObject({
      kind: 'LATE_CHARGEBACK',
      status: 'OPEN',
      amount: '4000',
    });
    expect(await lateAnomalies()).toBe(before + 1);
    const replay = await c.handle(t.row, c.notification(t.row, dispute, 4_000));
    expect(replay.outcome).toBe('NO_EFFECT');
    expect(await c.chargebacks(t.row.topupId)).toHaveLength(1);
    expect(await lateAnomalies()).toBe(before + 1);
    expect(await c.walletStatus(t.walletId)).toBe('ACTIVE');
  });

  it('demande par une personne, approbation par une autre : 1 transaction BACKOFFICE, même clé, anomalie résolue', async () => {
    const { t, dispute, cb } = await received(4_000, 8_000);
    const asked = await ask(cb.psp_chargeback_id);
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({ action: 'LATE_CHARGEBACK', status: 'PENDING' });
    expect(asked.body.target_id).toBe(cb.psp_chargeback_id);
    const [row] = await ownerRows<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM approval_request WHERE id = $1',
      [asked.body.approval_request_id],
    );
    expect(row!.payload).toEqual({
      chargeback_id: cb.psp_chargeback_id,
      scope_type: 'EVENT',
      scope_id: c.p.ev.eventId,
    });
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
    // Une seconde demande pour la même contestation est refusée tant qu'une est PENDING.
    expect((await ask(cb.psp_chargeback_id)).status).toBe(409);

    const done = await approve(asked.body.approval_request_id);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    const txs = await c.chargebackTxs(t.row.configurationId, dispute);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      source: 'BACKOFFICE',
      created_by: author().userId,
      approved_by: validator().userId,
    });
    expect(txs[0]!.metadata).toMatchObject({ approval_request_id: asked.body.approval_request_id });
    const [after] = await c.chargebacks(t.row.topupId);
    expect(after).toMatchObject({ chargeback_tx_id: txs[0]!.id, late: true });
    // Solde payé (2 000 après 8 000 dépensés) inférieur au montant : portefeuille bloqué.
    expect(after!.wallet_blocked).toBe(true);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
    expect(await anomalyOf(cb.anomaly_id)).toMatchObject({
      status: 'RESOLVED',
      resolution_tx_id: txs[0]!.id,
    });
    // Une demande après EXECUTED : refusée. Une notification rejouée : aucune seconde écriture.
    expect((await ask(cb.psp_chargeback_id)).status).toBe(409);
    const replay = await c.handle(t.row, c.notification(t.row, dispute, 4_000));
    expect(replay.outcome).toBe('NO_EFFECT');
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
  });

  it('l’auteur ne peut pas approuver sa propre demande : rien d’écrit', async () => {
    const { t, dispute, cb } = await received();
    const asked = await ask(cb.psp_chargeback_id);
    const res = await approve(asked.body.approval_request_id, author());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
    const [state] = await ownerRows<{ status: string }>(
      'SELECT status FROM approval_request WHERE id = $1',
      [asked.body.approval_request_id],
    );
    expect(state!.status).toBe('PENDING');
  });

  it('date limite des réclamations tardives dépassée : demande FAILED, rien d’écrit', async () => {
    const { t, dispute, cb } = await received();
    const asked = await ask(cb.psp_chargeback_id);
    await c.lockLedger("clock_timestamp() - interval '1 minute'");
    const res = await approve(asked.body.approval_request_id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failure_reason).toEqual(expect.any(String));
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(0);
    const [after] = await c.chargebacks(t.row.topupId);
    expect(after).toMatchObject({ chargeback_tx_id: null, late: true });
    expect((await anomalyOf(cb.anomaly_id)).status).toBe('OPEN');
  });

  it('rôles : CASHIER, SUPERVISOR de l’événement, PLATFORM_ADMIN refusés ; autre prestataire : 404', async () => {
    const { cb } = await received();
    expect((await ask(cb.psp_chargeback_id, c.cw.cashier2)).status).toBe(403);
    expect((await ask(cb.psp_chargeback_id, c.cw.supervisor)).status).toBe(403);
    expect((await ask(cb.psp_chargeback_id, c.cw.w.platformAdmin)).status).toBe(403);
    expect((await ask(cb.psp_chargeback_id, c.cw.organizerAdminOp2)).status).toBe(404);
    expect((await ask(randomUUID())).status).toBe(404);
    expect(
      await ownerRows(
        `SELECT 1 FROM approval_request WHERE action = 'LATE_CHARGEBACK' AND target_id = $1`,
        [cb.psp_chargeback_id],
      ),
    ).toHaveLength(0);
    // ORGANIZER_ADMIN et OPERATOR_ADMIN peuvent demander ; le second valideur est l'autre.
    const byOrganizer = await ask(cb.psp_chargeback_id, validator());
    expect(byOrganizer.status).toBe(202);
    expect(
      (await approve(byOrganizer.body.approval_request_id, c.cw.operatorAdmin2)).body.status,
    ).toBe('EXECUTED');
  });

  it('contestation non tardive (déjà écrite par la voie normale) : 409, jamais de seconde écriture', async () => {
    const t = await c.credited();
    const dispute = c.disputeId();
    await c.handle(t.row, c.notification(t.row, dispute, 1_000));
    const [cb] = await c.chargebacks(t.row.topupId);
    expect((await ask(cb!.psp_chargeback_id)).status).toBe(409);
    expect(await c.chargebackTxs(t.row.configurationId, dispute)).toHaveLength(1);
  });

  it('la clé de la voie tardive est celle de la voie normale (psp:<configuration>:<contestation>)', async () => {
    const { t, dispute, cb } = await received(500);
    const asked = await ask(cb.psp_chargeback_id);
    await approve(asked.body.approval_request_id);
    const [tx] = await ownerRows<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM journal_transaction WHERE id = $1`,
      [(await c.chargebacks(t.row.topupId))[0]!.chargeback_tx_id],
    );
    expect(tx!.idempotency_key).toBe(`psp:${t.row.configurationId}:${dispute}`);
  });
});
