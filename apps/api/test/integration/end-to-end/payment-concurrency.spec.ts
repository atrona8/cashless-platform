// Concurrence transverse des paiements (mission 5b, lot WP14, T070 ; NFR-005, NFR-006). Un seul jeu d'essai
// (paiement par bracelet, QR commerçant, QR client, annulation) : 20 envois simultanés de la même chose → une seule
// vente dans chaque cas, puis deux croisements (paiement QR pendant l'annulation de la demande ; annulation de
// vente pendant la suspension du terminal). Chaque cas affirme un INVARIANT (une vente, solde exact, aucune
// écriture partielle, aucun interblocage = aucune réponse 5xx), jamais un ordre d'arrivée. À lancer en SÉRIE
// avec le reste (`--runInBand`). Aucune hypothèse d'horloge entre Node et la base.
//
// Écritures directes en base : amorçage seulement (jeu d'essai commun des paiements).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TapService } from '../../../src/media/taps/tap.service';
import { DeviceSeqRegistry } from '../../../src/payments/device-seq-registry';
import { asPerson } from '../../support/device-e2e';
import { ownerRows } from '../../support/media-fixtures';
import { PaymentWorld, type PayMedia } from '../payments/payments-fixtures';
import { QrWorld, type QrCustomer } from '../payment-requests/qr-fixtures';
import { ReversalWorld } from '../reversals/reversal-fixtures';

jest.setTimeout(300_000);

const SUSPEND_REASON = 'Terminal signalé perdu par le commerçant, en recherche.';

describe('NFR-005 : concurrence transverse des paiements (WP14)', () => {
  let pw: PaymentWorld;
  let qw: QrWorld;
  let rw: ReversalWorld;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
    qw = new QrWorld(pw);
    rw = new ReversalWorld(pw);
  });
  afterAll(async () => {
    await pw?.close();
  });

  const histogram = (results: Array<{ status: number }>) =>
    results.reduce<Record<number, number>>(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
      {},
    );
  /** Aucun interblocage ni erreur serveur remontés : tout refus est un 4xx du contrat. */
  const noServerError = (results: Array<{ status: number; text: string }>) =>
    expect(results.filter((r) => r.status >= 500).map((r) => `${r.status} ${r.text}`)).toEqual([]);
  /** NFR-006 : chaque vente du terminal a son attribution, et chaque vente est complète au grand livre. */
  const noPartialWrite = async (deviceId: string) => {
    const f = await pw.footprint(deviceId);
    expect(f.attributions).toBe(f.sales);
    const orphans = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction t
        WHERE t.device_id = $1 AND t.type = 'PURCHASE'
          AND NOT EXISTS (SELECT 1 FROM posting p WHERE p.transaction_id = t.id)`,
      [deviceId],
    );
    expect(orphans[0]!.n).toBe(0);
  };

  it('20 paiements simultanés avec la MÊME lecture embarquée → 1 vente', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const tap = pw.tap(m);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => pw.pay(term, pw.keypadBody(term, { tap }, 1000))),
    );
    noServerError(results);
    expect(histogram(results)[201]).toBe(1);
    expect(await pw.salesOf(term.t.deviceId)).toBe(1);
    expect(await pw.spendable(m.walletId)).toBe(19_000);
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({ sales: 1, consumed: 1 });
    await noPartialWrite(term.t.deviceId);
  });

  it('20 paiements simultanés avec le MÊME tap_id → 1 vente', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const tapId = await pw.readTap(term, m);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => pw.pay(term, pw.keypadBody(term, { tap_id: tapId }, 1000))),
    );
    noServerError(results);
    expect(histogram(results)).toEqual({ 201: 1, 409: 19 });
    expect(await pw.salesOf(term.t.deviceId)).toBe(1);
    expect(await pw.spendable(m.walletId)).toBe(19_000);
    await noPartialWrite(term.t.deviceId);
  });

  it('20 paiements simultanés du MÊME jeton de QR commerçant → 1 vente', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const customers: QrCustomer[] = await Promise.all(
      Array.from({ length: 20 }, () => qw.customer(20_000)),
    );
    const created = await qw.create(term, qw.keypad(term, 3000));
    expect(created.status).toBe(201);
    const results = await Promise.all(customers.map((c) => qw.pay(c, created.id, created.token)));
    noServerError(results);
    expect(histogram(results)).toEqual({ 200: 1, 409: 19 });
    let debited = 0;
    for (const c of customers) debited += 20_000 - (await pw.spendable(c.walletId));
    expect(debited).toBe(3000);
    expect(await pw.salesOf(term.t.deviceId)).toBe(1);
    expect(await qw.row(created.id)).toMatchObject({ status: 'CONFIRMED' });
    await noPartialWrite(term.t.deviceId);
  });

  it('20 encaissements simultanés du MÊME QR client → 1 vente', async () => {
    const terminals = [
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
    ];
    const customer = await qw.customer(20_000);
    const made = await qw.asCustomer(customer, 'POST', '/me/customer-qr-tokens', {
      body: { wallet_id: customer.walletId },
    });
    expect(made.status).toBe(201);
    const token = String(made.body.token);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const term = terminals[i % terminals.length]!;
        return pw.pay(term, pw.keypadBody(term, { customer_qr_token: token }, 1000));
      }),
    );
    noServerError(results);
    expect(histogram(results)).toEqual({ 201: 1, 422: 19 });
    expect(await pw.spendable(customer.walletId)).toBe(19_000);
    const sales = await Promise.all(terminals.map((t) => pw.salesOf(t.t.deviceId)));
    expect(sales.reduce((a, b) => a + b, 0)).toBe(1);
    for (const t of terminals) await noPartialWrite(t.t.deviceId);
  });

  it('20 annulations simultanées de la même vente → 1 annulation', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const sale = await rw.sell(term, 4000);
    const results = await Promise.all(Array.from({ length: 20 }, () => rw.reverse(term, sale.id)));
    noServerError(results);
    expect(histogram(results)).toEqual({ 201: 1, 409: 19 });
    expect(await rw.reversalsOf(sale.id)).toHaveLength(1);
    expect(await pw.spendable(sale.media.walletId)).toBe(20_000);
  });

  it('croisé : paiement QR pendant l’annulation de la demande → une seule issue, jamais annulée avec une vente', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    for (let round = 0; round < 3; round += 1) {
      const customer = await qw.customer(20_000);
      const created = await qw.create(term, qw.keypad(term, 2000));
      expect(created.status).toBe(201);
      const [cancel, pay] = await Promise.all([
        qw.byTerminal(term, 'POST', created.id, '/cancel'),
        qw.pay(customer, created.id, created.token),
      ]);
      noServerError([cancel, pay]);
      const row = await qw.row(created.id);
      if (cancel.status === 200) {
        expect([pay.status, row.status, row.transaction_id]).toEqual([409, 'CANCELLED', null]);
        expect(await pw.spendable(customer.walletId)).toBe(20_000);
      } else {
        expect([cancel.status, pay.status, row.status]).toEqual([409, 200, 'CONFIRMED']);
        expect(await pw.spendable(customer.walletId)).toBe(18_000);
      }
    }
    await noPartialWrite(term.t.deviceId);
  });

  it('croisé : annulation de vente pendant la suspension du terminal → pas d’interblocage, état cohérent', async () => {
    const admin = asPerson(
      { baseUrl: pw.api.baseUrl, serverCaPem: pw.api.tls.serverCaPem },
      pw.w.operatorAdminA.token,
    );
    for (let round = 0; round < 3; round += 1) {
      const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
      const sale = await rw.sell(term, 4000);
      const [reversal, suspension] = await Promise.all([
        rw.reverse(term, sale.id),
        admin.post(
          `/devices/${term.t.deviceId}/suspend`,
          { reason: SUSPEND_REASON },
          { key: randomUUID() },
        ),
      ]);
      noServerError([reversal, suspension]);
      expect(suspension.status).toBe(200);
      const reversals = await rw.reversalsOf(sale.id);
      if (reversal.status === 201) {
        expect(reversals).toHaveLength(1);
        expect(await pw.spendable(sale.media.walletId)).toBe(20_000);
      } else {
        // Refus du contrat (terminal suspendu) : rien d'écrit, la vente reste entière.
        expect([403, 409, 422]).toContain(reversal.status);
        expect(reversals).toHaveLength(0);
        expect(await pw.spendable(sale.media.walletId)).toBe(16_000);
      }
      await noPartialWrite(term.t.deviceId);
    }
  });

  describe('pannes pendant un refus (reports WP11, NFR-006)', () => {
    it('panne du registre sur un refus qui n’est pas une lecture : l’erreur du registre remonte, rien n’est vendu, la clé reste rejouable', async () => {
      const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
      const [m] = (await pw.media(1, 500)) as [PayMedia];
      const registry = pw.api.app.get(DeviceSeqRegistry, { strict: false });
      const spy = jest.spyOn(registry, 'reject').mockRejectedValue(new Error('panne du registre'));
      try {
        // Fonds insuffisants : refus définitif registrable, hors lecture suspecte.
        const res = await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000));
        expect(res.status).toBe(500);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
      expect(await pw.salesOf(term.t.deviceId)).toBe(0);
      expect(await pw.spendable(m.walletId)).toBe(500);
      await noPartialWrite(term.t.deviceId);
    });

    it('échec du règlement d’une lecture refusée, sans erreur du registre : l’erreur du règlement remonte, rien n’est vendu', async () => {
      const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
      const [m] = (await pw.media(1)) as [PayMedia];
      const forged = pw.tap(m);
      forged.originality_signature = 'ab'.repeat(32);
      const taps = pw.api.app.get(TapService, { strict: false });
      const spy = jest
        .spyOn(taps, 'settleRefusal')
        .mockRejectedValue(new Error('panne du règlement'));
      try {
        // Lecture suspecte (signature d'originalité fausse) : refus avec règlement des effets durables.
        const res = await pw.pay(term, pw.keypadBody(term, { tap: forged }, 1000));
        expect(res.status).toBe(500);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
      expect(await pw.salesOf(term.t.deviceId)).toBe(0);
      expect(await pw.spendable(m.walletId)).toBe(20_000);
      await noPartialWrite(term.t.deviceId);
    });
  });
});
