// Intégration : déblocage d'un portefeuille bloqué par une contestation, action `WALLET_UNBLOCK` (mission 6, lot WP13,
// T067 et T068 ; FR-028 ; ADR-74). ORGANIZER_ADMIN seul, deux personnes distinctes, vérifié de nouveau par la base.
import { randomUUID } from 'node:crypto';
import { WALLET_UNBLOCK_ROLE } from '../../../src/chargebacks/wallet-unblock-action';
import { ownerRows } from '../../support/media-fixtures';
import type { TestPerson } from '../../support/fake-idp';
import { ChargebackWorld, type Credited } from './chargeback-fixtures';

jest.setTimeout(120_000);

describe('déblocage de portefeuille', () => {
  let c: ChargebackWorld;
  let second: TestPerson;
  beforeAll(async () => {
    c = await ChargebackWorld.create();
    second = await c.secondOrganizerAdmin();
  }, 240_000);
  afterAll(async () => {
    await c.close();
  });

  const author = () => c.cw.w.organizerAdminA;
  const ask = (
    walletId: string,
    who: TestPerson = author(),
    body: unknown = {},
    key = randomUUID(),
  ) => c.cw.bo('POST', `/wallets/${walletId}/unblock/approval-requests`, who, body, key);
  const approve = (id: unknown, who: TestPerson = second) =>
    c.cw.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});

  /** Portefeuille bloqué par une contestation que le solde payé n'a pas couverte. */
  async function blocked(): Promise<Credited> {
    const t = await c.credited({ amount: 10_000 });
    await c.spend(t.walletId, Number(t.net));
    await c.handle(t.row, c.notification(t.row, c.disputeId(), 2_000));
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
    return t;
  }

  it('le rôle est ORGANIZER_ADMIN seul (constante bornée)', () => {
    expect(WALLET_UNBLOCK_ROLE).toBe('ORGANIZER_ADMIN');
  });

  it('demande + seconde personne : portefeuille débloqué, contestation marquée, paiement de nouveau possible', async () => {
    const t = await blocked();
    const asked = await ask(t.walletId);
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({
      action: 'WALLET_UNBLOCK',
      status: 'PENDING',
      target_id: t.walletId,
    });
    const [row] = await ownerRows<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM approval_request WHERE id = $1',
      [asked.body.approval_request_id],
    );
    expect(row!.payload).toEqual({
      wallet_id: t.walletId,
      scope_type: 'EVENT',
      scope_id: c.p.ev.eventId,
    });
    // Rien n'a changé tant que la seconde personne n'a pas approuvé.
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
    const done = await approve(asked.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    expect(await c.walletStatus(t.walletId)).toBe('ACTIVE');
    expect((await c.chargebacks(t.row.topupId))[0]!.unblocked_by_request).toBe(
      asked.body.approval_request_id,
    );
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'WALLET_UNBLOCKED' AND object_id = $1`,
        [t.walletId],
      ),
    ).toHaveLength(1);
    // Le portefeuille peut de nouveau être rechargé.
    const again = await c.p.topup({
      method: 'CARD',
      wallet: { walletId: t.walletId, customer: t.customer },
    });
    expect((await c.p.pay(again.row)).outcome).toBe('CREDITED');
    // La contestation ne se rejoue pas : un second déblocage est refusé (plus de blocage par contestation).
    expect((await ask(t.walletId)).status).toBe(409);
  });

  it('même personne qui approuve : refus, le portefeuille reste bloqué', async () => {
    const t = await blocked();
    const asked = await ask(t.walletId);
    const res = await approve(asked.body.approval_request_id, author());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
  });

  it('valideur qui n’est pas ORGANIZER_ADMIN (OPERATOR_ADMIN) : refus, rien ne change', async () => {
    const t = await blocked();
    const asked = await ask(t.walletId);
    const res = await approve(asked.body.approval_request_id, c.cw.w.operatorAdminA);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
  });

  it('portefeuille non bloqué, ou bloqué hors contestation : 409, rien ne change', async () => {
    const free = await c.credited();
    expect((await ask(free.walletId)).status).toBe(409);
    const other = await c.p.wallet({ status: 'BLOCKED' });
    const res = await ask(other.walletId);
    expect(res.status).toBe(409);
    expect(await c.walletStatus(other.walletId)).toBe('BLOCKED');
    expect(
      await ownerRows(
        `SELECT 1 FROM approval_request WHERE action = 'WALLET_UNBLOCK' AND target_id = $1`,
        [other.walletId],
      ),
    ).toHaveLength(0);
  });

  it('bloqué pour une autre cause puis contesté : pas de voie de déblocage par contestation (0039)', async () => {
    const t = await c.credited({ amount: 10_000 });
    await c.spend(t.walletId, Number(t.net));
    // Portefeuille déjà BLOCKED (perte, fraude…) avant l'arrivée de la contestation.
    await ownerRows(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [t.walletId]);
    await c.handle(t.row, c.notification(t.row, c.disputeId(), 2_000));
    const [cb] = await c.chargebacks(t.row.topupId);
    expect(cb).toMatchObject({ wallet_blocked: false });
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
    const res = await ask(t.walletId);
    expect(res.status).toBe(409);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
    expect(
      await ownerRows(
        `SELECT 1 FROM approval_request WHERE action = 'WALLET_UNBLOCK' AND target_id = $1`,
        [t.walletId],
      ),
    ).toHaveLength(0);
  });

  it('autre prestataire, autre rôle, plateforme : refus sans fuite', async () => {
    const t = await blocked();
    expect((await ask(t.walletId, c.cw.organizerAdminOp2)).status).toBe(404);
    expect((await ask(t.walletId, c.cw.operatorAdmin2)).status).toBe(403);
    expect((await ask(t.walletId, c.cw.supervisor)).status).toBe(403);
    expect((await ask(t.walletId, c.cw.w.platformAdmin)).status).toBe(403);
    expect((await ask(randomUUID())).status).toBe(404);
    expect(await c.walletStatus(t.walletId)).toBe('BLOCKED');
  });
});
