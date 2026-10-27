// Paiement : concurrence (mission 5b, lot WP11, T048 à T050, T054 ; NFR-005, NFR-006 ; ordre global des verrous
// terminal → vendeur → session → demande QR → bracelet → portefeuille, A7). À lancer EN SÉRIE avec le reste
// (`--runInBand`) : les requêtes partent ensemble et l'issue est départagée par les verrous de la base, pas par
// le hasard — chaque test affirme un INVARIANT (exactement une vente, solde exact), jamais un ordre d'arrivée.
import 'reflect-metadata';
import { PaymentWorld, type PayMedia, type PayTerminal } from './payments-fixtures';

jest.setTimeout(240_000);

describe('createPayment : concurrence (WP11, NFR-005)', () => {
  let pw: PaymentWorld;
  let keypad: PayTerminal;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
    keypad = await pw.terminal({ mode: 'KEYPAD_TPE' });
  });
  afterAll(async () => {
    await pw?.close();
  });

  const statuses = (results: Array<{ status: number }>) =>
    results.reduce<Record<number, number>>(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
      {},
    );

  it('20 paiements simultanés avec la MÊME lecture embarquée → exactement une vente, un seul débit', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const tap = pw.tap(m);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => pw.pay(keypad, pw.keypadBody(keypad, { tap }, 1000))),
    );
    expect(statuses(results)[201]).toBe(1);
    expect(
      results.filter((r) => r.status !== 201).every((r) => r.status >= 400 && r.status < 500),
    ).toBe(true);
    expect(await pw.salesOf(keypad.t.deviceId)).toBe(1);
    expect(await pw.spendable(m.walletId)).toBe(19_000);
    const footprint = await pw.footprint(keypad.t.deviceId);
    expect(footprint).toMatchObject({ sales: 1, attributions: 1, consumed: 1, accepted: 1 });
  });

  it('20 paiements simultanés avec le MÊME tap_id → exactement une vente, les autres TAP_UNUSABLE', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const tapId = await pw.readTap(term, m);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => pw.pay(term, pw.keypadBody(term, { tap_id: tapId }, 1000))),
    );
    expect(statuses(results)).toEqual({ 201: 1, 409: 19 });
    expect(new Set(results.filter((r) => r.status === 409).map((r) => r.body.code))).toEqual(
      new Set(['TAP_UNUSABLE']),
    );
    expect(await pw.salesOf(term.t.deviceId)).toBe(1);
    expect(await pw.spendable(m.walletId)).toBe(19_000);
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({
      sales: 1,
      consumed: 1,
      accepted: 1,
      rejected: 19,
    });
  });

  it('20 paiements simultanés avec le MÊME QR client, depuis des terminaux différents → exactement une vente', async () => {
    const terminals = [
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
    ];
    const [m] = (await pw.media(1)) as [PayMedia];
    const token = await pw.customerQr(m.walletId);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const term = terminals[i % terminals.length]!;
        return pw.pay(term, pw.keypadBody(term, { customer_qr_token: token }, 1000));
      }),
    );
    expect(statuses(results)).toEqual({ 201: 1, 422: 19 });
    expect(new Set(results.filter((r) => r.status === 422).map((r) => r.body.code))).toEqual(
      new Set(['QR_TOKEN_INVALID']),
    );
    expect(await pw.spendable(m.walletId)).toBe(19_000);
    const total = (await Promise.all(terminals.map((t) => pw.footprint(t.t.deviceId)))).reduce(
      (n, f) => n + f.sales,
      0,
    );
    expect(total).toBe(1);
  });

  it('portefeuille de 5 000 débité par 12 QR simultanés de 1 000 depuis 3 terminaux → exactement 5 ventes, solde nul, aucun interblocage', async () => {
    const terminals = [
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
      await pw.terminal({ mode: 'KEYPAD_TPE' }),
    ];
    const [m] = (await pw.media(1, 5000)) as [PayMedia];
    const tokens = [];
    for (let i = 0; i < 12; i += 1) tokens.push(await pw.customerQr(m.walletId));
    const results = await Promise.all(
      tokens.map((token, i) => {
        const term = terminals[i % terminals.length]!;
        return pw.pay(term, pw.keypadBody(term, { customer_qr_token: token }, 1000));
      }),
    );
    expect(statuses(results)).toEqual({ 201: 5, 422: 7 });
    expect(new Set(results.filter((r) => r.status === 422).map((r) => r.body.code))).toEqual(
      new Set(['INSUFFICIENT_FUNDS']),
    );
    expect(await pw.spendable(m.walletId)).toBe(0);
  });

  it('MÊME clé et MÊME corps envoyés 10 fois ensemble → une seule vente, un seul débit, les autres attendent ou rejouent', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const key = term.t.seqKey();
    const body = pw.keypadBody(term, { tap: pw.tap(m) }, 1000);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => pw.pay(term, body, { key })),
    );
    const fresh = results.filter((r) => r.status === 201 && !r.headers['idempotency-replayed']);
    expect(fresh).toHaveLength(1);
    // Les autres : clé en cours (409), ou, arrivés après la fin, rejeu de la même réponse.
    for (const r of results.filter((x) => x !== fresh[0])) {
      if (r.status === 201) expect(r.headers['idempotency-replayed']).toBe('true');
      else expect([r.status, r.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_IN_PROGRESS']);
    }
    expect(await pw.salesOf(term.t.deviceId)).toBe(1);
    expect(await pw.spendable(m.walletId)).toBe(19_000);
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({
      sales: 1,
      accepted: 1,
      consumed: 1,
    });
  });

  it('MÊME clé et 10 corps DIFFÉRENTS envoyés ensemble → une seule vente, les autres IDEMPOTENCY_KEY_REUSED (ou en cours)', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const key = term.t.seqKey();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000 + i), { key }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201))
      expect(['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_IN_PROGRESS']).toContain(r.body.code);
    expect(await pw.salesOf(term.t.deviceId)).toBe(1);
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({
      sales: 1,
      accepted: 1,
      consumed: 1,
    });
  });
});
