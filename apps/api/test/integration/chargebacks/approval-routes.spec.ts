// Intégration : routes de demande `requestLateChargeback` et `requestWalletUnblock` (mission 6, lot WP13, T066, T067 et
// T068 ; contrat WP01). 202 avec l'ApprovalRequest conforme au contrat, `Location`, rôles, 404 hors prestataire, rejeu de
// clé, corps vide exigé, `PLATFORM_ADMIN` refusé. Rien n'est écrit par la demande.
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows } from '../../support/media-fixtures';
import { ChargebackWorld } from './chargeback-fixtures';

jest.setTimeout(120_000);

describe('routes de demande des contestations', () => {
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

  const admin = () => c.cw.w.organizerAdminA;
  const post = (
    path: string,
    who = admin(),
    body: unknown = {},
    key: string | null = randomUUID(),
  ) => c.cw.bo('POST', path, who, body, key);

  async function lateChargeback() {
    const t = await c.credited();
    await c.lockLedger();
    await c.handle(t.row, c.notification(t.row, c.disputeId(), 1_000));
    return (await c.chargebacks(t.row.topupId))[0]!.psp_chargeback_id;
  }
  async function blockedWallet() {
    const t = await c.credited();
    await c.spend(t.walletId, Number(t.net));
    await c.handle(t.row, c.notification(t.row, c.disputeId(), 1_000));
    return t.walletId;
  }

  it('requestLateChargeback : 202, contrat respecté, Location, rejeu de clé, rien d’écrit', async () => {
    const id = await lateChargeback();
    const key = randomUUID();
    const res = await post(`/chargebacks/${id}/approval-requests`, admin(), {}, key);
    expect(res.status).toBe(202);
    expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
    expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
    const replay = await post(`/chargebacks/${id}/approval-requests`, admin(), {}, key);
    expect(replay.body).toEqual(res.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(
      await ownerRows(`SELECT 1 FROM approval_request WHERE target_id = $1`, [id]),
    ).toHaveLength(1);
    expect(
      await ownerRows(
        `SELECT 1 FROM journal_transaction WHERE type = 'CHARGEBACK' AND approved_by IS NOT NULL AND metadata->>'approval_request_id' = $1`,
        [res.body.approval_request_id],
      ),
    ).toHaveLength(0);
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'LATE_CHARGEBACK_REQUESTED' AND object_id = $1`,
        [id],
      ),
    ).toHaveLength(1);
  });

  it('requestWalletUnblock : 202, contrat respecté, Location, rejeu de clé', async () => {
    const walletId = await blockedWallet();
    const key = randomUUID();
    const res = await post(`/wallets/${walletId}/unblock/approval-requests`, admin(), {}, key);
    expect(res.status).toBe(202);
    expect(contractViolations('ApprovalRequest', res.body)).toEqual([]);
    expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
    const replay = await post(`/wallets/${walletId}/unblock/approval-requests`, admin(), {}, key);
    expect(replay.body).toEqual(res.body);
    expect(await c.walletStatus(walletId)).toBe('BLOCKED');
    expect(
      await ownerRows(
        `SELECT 1 FROM audit_log WHERE action = 'WALLET_UNBLOCK_REQUESTED' AND object_id = $1`,
        [walletId],
      ),
    ).toHaveLength(1);
  });

  it('corps non vide, clé absente ou non UUID, identifiant mal formé : refus avant toute écriture', async () => {
    const walletId = await blockedWallet();
    const path = `/wallets/${walletId}/unblock/approval-requests`;
    expect((await post(path, admin(), { wallet_id: walletId })).status).toBe(422);
    expect((await post(path, admin(), {}, null)).status).toBe(400);
    expect((await post(path, admin(), {}, 'pas-un-uuid')).status).toBe(422);
    expect((await post('/wallets/pas-un-uuid/unblock/approval-requests')).status).toBe(404);
    expect((await post('/chargebacks/pas-un-uuid/approval-requests')).status).toBe(404);
    expect(
      await ownerRows(`SELECT 1 FROM approval_request WHERE target_id = $1`, [walletId]),
    ).toHaveLength(0);
  });

  it('rôles : PLATFORM_ADMIN, CASHIER et SUPERVISOR refusés (403) ; prestataire B : 404', async () => {
    const walletId = await blockedWallet();
    const id = await lateChargeback();
    for (const path of [
      `/chargebacks/${id}/approval-requests`,
      `/wallets/${walletId}/unblock/approval-requests`,
    ]) {
      expect((await post(path, c.cw.w.platformAdmin)).status).toBe(403);
      expect((await post(path, c.cw.cashier2)).status).toBe(403);
      expect((await post(path, c.cw.supervisor)).status).toBe(403);
      expect((await post(path, c.cw.organizerAdminOp2)).status).toBe(404);
      expect((await post(path, c.cw.operatorAdminOp2)).status).toBe(
        path.startsWith('/wallets') ? 403 : 404,
      );
    }
  });
});
