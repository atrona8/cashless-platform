// Intégration : suivi et annulation d'une recharge PSP (`getPspTopup`, `cancelPspTopup`, lot WP11, T055 ;
// FR-016 ; A13). Visible du demandeur seulement (même terminal ET même personne, ou même festivalier) et d'un
// `ORGANIZER_ADMIN` de l'événement ; tout autre : 404 identique à une recharge inexistante. `CANCELLED`
// uniquement après confirmation de l'adaptateur.
import { randomUUID } from 'node:crypto';
import type { TestPerson } from '../../support/fake-idp';
import type { TestTerminal } from '../../support/test-terminal';
import { ownerRows } from '../../support/media-fixtures';
import { PspWorld } from './psp-fixtures';

describe('suivi et annulation d’une recharge PSP', () => {
  let p: PspWorld;
  let t: TestTerminal;
  let otherTerminal: TestTerminal;
  let cashier2: TestPerson;

  beforeAll(async () => {
    p = await PspWorld.create();
    t = await p.sw.terminal();
    otherTerminal = await p.sw.terminal();
    cashier2 = p.sw.cashier2;
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    p.adapter('WAVE').acceptCancel(true);
  });

  const deskTopup = async () => {
    const { walletId } = await p.wallet();
    const res = await p.desk(t, 'POST', '/topups/psp', p.w.cashierA, p.body(walletId));
    expect(res.status).toBe(201);
    return { id: res.body.topup_id as string, walletId };
  };
  const customerTopup = async () => {
    const w = await p.wallet();
    const res = await p.cust(w.customer, 'POST', '/topups/psp', p.body(w.walletId));
    expect(res.status).toBe(201);
    return { id: res.body.topup_id as string, ...w };
  };
  const status = (id: string) =>
    ownerRows<{ status: string }>('SELECT status FROM psp_topup WHERE psp_topup_id = $1', [
      id,
    ]).then((r) => r[0]!.status);

  describe('suivi', () => {
    it('le demandeur guichet voit sa recharge ; aucun appel du PSP', async () => {
      const { id, walletId } = await deskTopup();
      const adapter = p.adapter('WAVE');
      const spies = [
        jest.spyOn(adapter, 'getStatus'),
        jest.spyOn(adapter, 'initiate'),
        jest.spyOn(adapter, 'cancel'),
      ];
      const res = await p.desk(t, 'GET', `/topups/psp/${id}`, p.w.cashierA);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ topup_id: id, status: 'PENDING', wallet_id: walletId });
      expect(spies.map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
    });

    it('un tiers reçoit 404 : autre personne du même terminal, même personne d’un autre terminal', async () => {
      const { id } = await deskTopup();
      const missing = await p.desk(t, 'GET', `/topups/psp/${randomUUID()}`, p.w.cashierA);
      for (const res of [
        await p.desk(t, 'GET', `/topups/psp/${id}`, cashier2),
        await p.desk(otherTerminal, 'GET', `/topups/psp/${id}`, p.w.cashierA),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(missing.body.code);
      }
    });

    it('festivalier : le sien seulement ; un autre festivalier 404', async () => {
      const mine = await customerTopup();
      const other = await p.customer();
      expect((await p.cust(mine.customer, 'GET', `/topups/psp/${mine.id}`)).status).toBe(200);
      expect((await p.cust(other, 'GET', `/topups/psp/${mine.id}`)).status).toBe(404);
    });

    it('ORGANIZER_ADMIN de l’événement : 200 ; autre prestataire, OPERATOR_ADMIN seul, caissier : 404', async () => {
      const { id } = await customerTopup();
      expect((await p.sw.bo('GET', `/topups/psp/${id}`, p.w.organizerAdminA)).status).toBe(200);
      for (const who of [p.sw.organizerAdminOp2, p.sw.operatorAdminOp2, p.w.operatorAdminA])
        expect((await p.sw.bo('GET', `/topups/psp/${id}`, who)).status).toBe(404);
      expect(
        (await p.sw.bo('GET', `/topups/psp/${randomUUID()}`, p.w.organizerAdminA)).status,
      ).toBe(404);
    });

    it('recharge échouée : failure_reason rendu', async () => {
      const { id } = await deskTopup();
      await p.tx.run(p.op, (c) => c.query(`SELECT fail_psp_topup($1, 'PSP_FAILED', false)`, [id]));
      const res = await p.desk(t, 'GET', `/topups/psp/${id}`, p.w.cashierA);
      expect(res.body).toMatchObject({ status: 'FAILED', failure_reason: 'PSP_FAILED' });
    });

    it('route sans identifiant : 401', async () => {
      const { id } = await deskTopup();
      expect((await p.desk(t, 'GET', `/topups/psp/${id}`, null)).status).toBe(401);
    });
  });

  describe('annulation', () => {
    it('le demandeur annule après confirmation du PSP : CANCELLED, audit, rejeu 200', async () => {
      const { id } = await deskTopup();
      const res = await p.desk(t, 'POST', `/topups/psp/${id}/cancel`, p.w.cashierA);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(await status(id)).toBe('CANCELLED');
      expect(
        await ownerRows(
          `SELECT 1 FROM audit_log WHERE action = 'PSP_TOPUP_CANCELLED' AND object_id = $1`,
          [id],
        ),
      ).toHaveLength(1);
      // Déjà annulée : idempotent, sans nouvel appel du PSP.
      const cancel = jest.spyOn(p.adapter('WAVE'), 'cancel');
      const again = await p.desk(t, 'POST', `/topups/psp/${id}/cancel`, p.w.cashierA);
      expect([again.status, again.body.status]).toEqual([200, 'CANCELLED']);
      expect(cancel).not.toHaveBeenCalled();
    });

    it('annulation NON confirmée par le PSP : 409, la recharge reste PENDING', async () => {
      const { id } = await deskTopup();
      p.adapter('WAVE').acceptCancel(false);
      const res = await p.desk(t, 'POST', `/topups/psp/${id}/cancel`, p.w.cashierA);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT_STATE');
      expect(await status(id)).toBe('PENDING');
      expect(
        await ownerRows(
          `SELECT 1 FROM audit_log WHERE action = 'PSP_TOPUP_CANCELLED' AND object_id = $1`,
          [id],
        ),
      ).toEqual([]);
    });

    it('un tiers ne peut pas annuler : 404 et le PSP n’est pas appelé', async () => {
      const { id } = await deskTopup();
      const cancel = jest.spyOn(p.adapter('WAVE'), 'cancel');
      expect((await p.desk(t, 'POST', `/topups/psp/${id}/cancel`, cashier2)).status).toBe(404);
      expect(
        (await p.desk(otherTerminal, 'POST', `/topups/psp/${id}/cancel`, p.w.cashierA)).status,
      ).toBe(404);
      const mine = await customerTopup();
      const stranger = await p.customer();
      expect((await p.cust(stranger, 'POST', `/topups/psp/${mine.id}/cancel`)).status).toBe(404);
      expect(cancel).not.toHaveBeenCalled();
      expect(await status(id)).toBe('PENDING');
    });

    it('recharge créditée ou échue : 409, rien d’annulé', async () => {
      const paid = await customerTopup();
      const row = (await p.read(paid.id))!;
      await p.pay(row, { paymentRef: row.providerPaymentRef! });
      expect((await p.cust(paid.customer, 'POST', `/topups/psp/${paid.id}/cancel`)).status).toBe(
        409,
      );
      expect(await status(paid.id)).toBe('SUCCEEDED');
      const gone = await customerTopup();
      await p.tx.run(p.op, (c) =>
        c.query(`SELECT fail_psp_topup($1, 'PSP_FAILED', false)`, [gone.id]),
      );
      expect((await p.cust(gone.customer, 'POST', `/topups/psp/${gone.id}/cancel`)).status).toBe(
        409,
      );
    });

    it('annulation et notification de succès simultanées : un seul crédit, état final cohérent', async () => {
      const mine = await customerTopup();
      const row = (await p.read(mine.id))!;
      const [cancel] = await Promise.all([
        p.cust(mine.customer, 'POST', `/topups/psp/${mine.id}/cancel`),
        p.pay(row, { paymentRef: row.providerPaymentRef! }),
      ]);
      expect([200, 409]).toContain(cancel.status);
      // Soit SUCCEEDED puis 409, soit CANCELLED puis succès tardif crédité par le tableau (R-20).
      expect(await status(mine.id)).toBe('SUCCEEDED');
      expect(await p.transactions(mine.id)).toHaveLength(1);
    });
  });
});
