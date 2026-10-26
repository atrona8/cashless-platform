// Paiement par bracelet ou QR client : réussites (mission 5b, lot WP11, T048 à T052, T054 ; FR-006, FR-009 à
// FR-015, FR-019, FR-020, NFR-006, NFR-008 ; contracts/payments.md, contracts/qr-payments.md). Terminaux enrôlés
// par les fonctions de la base, requêtes HTTPS signées (trois preuves, identité réelle). Les refus sont dans
// payments-refusals.spec.ts, la concurrence dans payments-concurrency.spec.ts.
//
// Heures : l'heure de référence est lue en base (jamais l'horloge de Node contre `now()`), et l'écart d'un
// `CLOCK_SKEW` est d'une heure.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { purchaseContent } from '../../../src/payments/device-seq-registry';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows } from '../../support/media-fixtures';
import { PaymentWorld, type PayMedia, type PayTerminal } from './payments-fixtures';

jest.setTimeout(180_000);

describe('createPayment : réussites (WP11)', () => {
  let pw: PaymentWorld;
  let bar: PayTerminal;
  let keypad: PayTerminal;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
    bar = await pw.terminal({ mode: 'CATALOG_POS' });
    keypad = await pw.terminal({ mode: 'KEYPAD_TPE' });
  });
  afterAll(async () => {
    await pw?.close();
  });

  const dbNow = async (): Promise<Date> =>
    (await ownerRows<{ now: Date }>('SELECT clock_timestamp() AS now'))[0]!.now;

  it('FR-009, FR-011, FR-012 : lecture embarquée sur une caisse catalogue → 201, lignes copiées, vente attribuée au vendeur de la session', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const body = pw.catalogBody(bar, { tap: pw.tap(m) }, [
      [0, 2],
      [1, 1],
    ]);
    const res = await pw.pay(bar, body, { language: 'fr' });
    expect(res.status).toBe(201);
    expect(contractViolations('PaymentResult', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      type: 'PURCHASE',
      status: 'SUCCEEDED',
      amount: 7500,
      currency: 'XOF',
      media_id: m.media.id,
      wallet_id: m.walletId,
      channel: 'NFC',
      vendor: { vendor_id: pw.vendorId, display_name: pw.vendorName },
      balance_after: { spendable: 12_500, paid: 12_500, promo: 0 },
    });
    expect(res.body.lines).toEqual([
      expect.objectContaining({
        product_id: pw.items[0]!.id,
        label: 'Bière',
        quantity: 2,
        unit_price: 3000,
        vat_rate_bps: 1800,
        line_total: 6000,
      }),
      expect.objectContaining({ product_id: pw.items[1]!.id, quantity: 1, line_total: 1500 }),
    ]);
    const txId = res.body.transaction_id as string;
    // La vente, ses lignes copiées du catalogue, son attribution, le passage consommé, le numéro accepté.
    expect(await pw.spendable(m.walletId)).toBe(12_500);
    const sale = await ownerRows<{ idempotency_key: string; source: string; device_id: string }>(
      'SELECT idempotency_key, source, device_id FROM journal_transaction WHERE id = $1',
      [txId],
    );
    expect(sale).toEqual([
      { idempotency_key: res.body.idempotency_key, source: 'ONLINE', device_id: bar.t.deviceId },
    ]);
    expect(
      await ownerRows(
        'SELECT line_no, item_id, quantity, unit_price::text AS unit_price FROM sale_line WHERE transaction_id = $1 ORDER BY line_no',
        [txId],
      ),
    ).toEqual([
      { line_no: 1, item_id: pw.items[0]!.id, quantity: 2, unit_price: '3000' },
      { line_no: 2, item_id: pw.items[1]!.id, quantity: 1, unit_price: '1500' },
    ]);
    expect(
      await ownerRows(
        'SELECT vendor_id, vendor_session_id, device_id, channel FROM sale_attribution WHERE transaction_id = $1',
        [txId],
      ),
    ).toEqual([
      {
        vendor_id: pw.vendorId,
        vendor_session_id: bar.sessionId,
        device_id: bar.t.deviceId,
        channel: 'NFC',
      },
    ]);
    expect(
      await ownerRows('SELECT transaction_id FROM media_tap WHERE device_id = $1', [
        bar.t.deviceId,
      ]),
    ).toEqual(expect.arrayContaining([{ transaction_id: txId }]));
    // Registre : numéro accepté, lié à la vente, contenu = empreinte des champs chaînés du corps reçu.
    const seq = String(Number(String(res.body.idempotency_key).split(':')[1]));
    const registry = (await pw.registry(bar.t.deviceId)).find((r) => r.seq === seq);
    expect(registry).toMatchObject({
      outcome: 'ACCEPTED',
      transaction_id: txId,
      channel: 'ONLINE',
      reason: null,
    });
    expect(registry!.content_sha256.equals(purchaseContent(BigInt(seq), body)!)).toBe(true);
    // La commission du commerçant (12 %) et la TVA sont écrites par le moteur : la vente est équilibrée.
    expect(
      (
        await ownerRows<{ s: string }>(
          'SELECT sum(amount)::text AS s FROM posting WHERE transaction_id = $1',
          [txId],
        )
      )[0]!.s,
    ).toBe('0');
  });

  it('FR-009 : libellé dans la langue de la requête (Accept-Language)', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const res = await pw.pay(bar, pw.catalogBody(bar, { tap: pw.tap(m) }), { language: 'en' });
    expect(res.status).toBe(201);
    expect((res.body.lines as Array<{ label: string }>)[0]!.label).toBe('Beer');
  });

  it('FR-009, FR-010 : tap_id sur un TPE simplifié (sans lignes) → 201 ; le passage est consommé', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const tapId = await pw.readTap(keypad, m);
    const res = await pw.pay(keypad, pw.keypadBody(keypad, { tap_id: tapId }, 4000));
    expect(res.status).toBe(201);
    expect(contractViolations('PaymentResult', res.body)).toEqual([]);
    expect(res.body).toMatchObject({ amount: 4000, channel: 'NFC', media_id: m.media.id });
    expect(res.body.lines).toBeUndefined();
    expect(await ownerRows('SELECT transaction_id FROM media_tap WHERE id = $1', [tapId])).toEqual([
      { transaction_id: res.body.transaction_id },
    ]);
    expect(await pw.spendable(m.walletId)).toBe(16_000);
  });

  it('FR-019, FR-020, NFR-008 : QR client → 201, canal CUSTOMER_QR, demande CONFIRMED liée à la vente ; le jeton n’est nulle part', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const token = await pw.customerQr(m.walletId);
    const stderr = jest.spyOn(process.stderr, 'write');
    const res = await pw.pay(keypad, pw.keypadBody(keypad, { customer_qr_token: token }, 2500));
    const logged = stderr.mock.calls.map((c) => String(c[0])).join('');
    stderr.mockRestore();
    expect(res.status).toBe(201);
    expect(contractViolations('PaymentResult', res.body)).toEqual([]);
    expect(res.body).toMatchObject({ channel: 'CUSTOMER_QR', amount: 2500, media_id: null });
    const txId = res.body.transaction_id as string;
    expect(
      await ownerRows(
        'SELECT status, transaction_id, amount::int AS amount, device_id FROM payment_request WHERE wallet_id = $1',
        [m.walletId],
      ),
    ).toEqual([
      { status: 'CONFIRMED', transaction_id: txId, amount: 2500, device_id: keypad.t.deviceId },
    ]);
    expect(
      await ownerRows('SELECT channel, vendor_id FROM sale_attribution WHERE transaction_id = $1', [
        txId,
      ]),
    ).toEqual([{ channel: 'CUSTOMER_QR', vendor_id: pw.vendorId }]);
    expect(await pw.spendable(m.walletId)).toBe(17_500);
    // NFR-008 : ni le jeton ni son empreinte dans la réponse, le registre d'idempotence, l'audit, les métadonnées,
    // le contenu haché du registre ou les journaux du serveur.
    const hash = (await import('../../../src/payments/qr-token-hash')).qrTokenHash(token);
    const needles = [
      token,
      hash.toString('hex'),
      hash.toString('base64'),
      hash.toString('base64url'),
    ];
    const haystacks = [
      res.text,
      logged,
      ...(await ownerRows<{ t: string }>('SELECT t::text AS t FROM api_idempotency t')).map(
        (r) => r.t,
      ),
      ...(await ownerRows<{ t: string }>('SELECT t::text AS t FROM audit_log t')).map((r) => r.t),
      ...(
        await ownerRows<{ t: string }>('SELECT metadata::text AS t FROM journal_transaction')
      ).map((r) => r.t),
    ];
    for (const needle of needles)
      for (const haystack of haystacks) expect(haystack).not.toContain(needle);
  });

  it('FR-015 : un iOS paie par QR client (le bracelet lui est interdit, voir les refus)', async () => {
    const ios = await pw.terminal({ os: 'IOS', mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const token = await pw.customerQr(m.walletId);
    const res = await pw.pay(ios, pw.keypadBody(ios, { customer_qr_token: token }, 1000));
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe('CUSTOMER_QR');
  });

  it('FR-015 : un téléphone personnel (KEYPAD_TPE) encaisse en ligne', async () => {
    const phone = await pw.terminal({ mode: 'KEYPAD_TPE' });
    await ownerRows('UPDATE device SET personal_phone = true WHERE id = $1 RETURNING id', [
      phone.t.deviceId,
    ]);
    const [m] = (await pw.media(1)) as [PayMedia];
    const res = await pw.pay(phone, pw.keypadBody(phone, { tap: pw.tap(m) }, 1500));
    expect(res.status).toBe(201);
  });

  it('FR-006 : le vendeur de la vente est celui de la session ; un vendeur, un canal ou un terminal envoyés dans le corps sont ignorés', async () => {
    const other = await pw.terminal({ session: false });
    const second = await (async () => {
      const { seedVendor } = await import('../vendors/vendor-fixtures');
      const { withOwner } = await import('../../support/db');
      return withOwner(async (db) =>
        seedVendor(db, {
          operatorId: pw.w.ops.a,
          merchantId: pw.pos.merchantId,
          actorId: pw.w.operatorAdminA.userId,
          displayName: 'Binta',
          pinHash: await pw.hasher.hash('135790'),
        }),
      );
    })();
    await pw.openSession(other, second);
    const [m] = (await pw.media(1)) as [PayMedia];
    const body = pw.catalogBody(other, { tap: pw.tap(m) }, [[1, 2]], {
      vendor_id: pw.vendorId,
      channel: 'MERCHANT_QR',
      device_id: bar.t.deviceId,
      operator_id: randomUUID(),
    });
    const res = await pw.pay(other, body);
    expect(res.status).toBe(201);
    expect(res.body.vendor).toEqual({ vendor_id: second, display_name: 'Binta' });
    expect(
      await ownerRows(
        'SELECT vendor_id, device_id, channel FROM sale_attribution WHERE transaction_id = $1',
        [res.body.transaction_id],
      ),
    ).toEqual([{ vendor_id: second, device_id: other.t.deviceId, channel: 'NFC' }]);
  });

  it('FR-011, FR-012 : CATALOG_POS vend au prix courant ET au prix de la dernière version servie ; refuse un prix qui n’est ni l’un ni l’autre', async () => {
    const { pos, items, vendorId } = await pw.newPos([['Eau', 'Water', 500]]);
    const term = await pw.terminal({ mode: 'CATALOG_POS', posId: pos.posId, vendorId });
    const item = items[0]!;
    await pw.serveCatalog(term.t.deviceId); // version servie : prix 500
    await pw.setPrice(item.id, 700); // version courante : prix 700
    const [m] = (await pw.media(1)) as [PayMedia];
    const line = (price: number) => ({ product_id: item.id, quantity: 2, unit_price: price });
    const sale = (price: number, means: Record<string, unknown>) => ({
      amount: 2 * price,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      vendor_session_id: term.sessionId,
      lines: [line(price)],
      ...means,
    });
    const served = await pw.pay(term, sale(500, { tap: pw.tap(m) }));
    const current = await pw.pay(term, sale(700, { tap: pw.tap(m) }));
    const neither = await pw.pay(term, sale(600, { tap: pw.tap(m) }));
    expect([served.status, current.status, neither.status]).toEqual([201, 201, 422]);
    expect(neither.body.code).toBe('SALE_LINES_INVALID');
    const versions = await ownerRows<{ catalog_version: number; unit_price: string }>(
      `SELECT l.catalog_version, l.unit_price::text FROM sale_line l WHERE l.item_id = $1 ORDER BY l.catalog_version`,
      [item.id],
    );
    expect(versions.map((v) => v.unit_price)).toEqual(['500', '700']);
    expect(versions[0]!.catalog_version).toBeLessThan(versions[1]!.catalog_version);
  });

  it('rejeu de la même clé : même réponse, Idempotency-Replayed, une seule vente', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const body = pw.keypadBody(keypad, { tap: pw.tap(m) }, 1200);
    const key = keypad.t.seqKey();
    const first = await pw.pay(keypad, body, { key });
    const again = await pw.pay(keypad, body, { key });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(await pw.spendable(m.walletId)).toBe(18_800);
    expect(
      await ownerRows(
        'SELECT count(*)::int AS n FROM journal_transaction WHERE idempotency_key = $1',
        [key],
      ),
    ).toEqual([{ n: 1 }]);
    // Même clé, autre contenu : refusée, rien de plus n'est écrit.
    const other = await pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1300), { key });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await pw.spendable(m.walletId)).toBe(18_800);
  });

  it('A5 : heure écartée de plus de 120 s → écrite à l’heure de la base, heure reçue en métadonnée, anomalie CLOCK_SKEW', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const received = new Date((await dbNow()).getTime() - 3600_000).toISOString();
    const res = await pw.pay(
      keypad,
      pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000, { occurred_at: received }),
    );
    expect(res.status).toBe(201);
    const txId = res.body.transaction_id as string;
    const row = (
      await ownerRows<{ gap: number; device_occurred_at: string; recorded: Date }>(
        `SELECT abs(extract(epoch FROM (occurred_at - recorded_at)))::float AS gap,
                metadata->>'device_occurred_at' AS device_occurred_at, recorded_at AS recorded
           FROM journal_transaction WHERE id = $1`,
        [txId],
      )
    )[0]!;
    expect(row.gap).toBeLessThan(10);
    expect(new Date(row.device_occurred_at).toISOString()).toBe(received);
    expect(new Date(res.body.occurred_at as string).getTime()).toBeGreaterThan(
      new Date(received).getTime() + 3000_000,
    );
    expect(
      await ownerRows(
        `SELECT kind, status, device_id, ledger_id, transaction_id, amount::int AS amount FROM anomaly WHERE transaction_id = $1`,
        [txId],
      ),
    ).toEqual([
      {
        kind: 'CLOCK_SKEW',
        status: 'OPEN',
        device_id: keypad.t.deviceId,
        ledger_id: pw.w.ids.ledgerA,
        transaction_id: txId,
        amount: 0,
      },
    ]);
  });

  it('A5 : heure dans la tolérance → conservée telle que reçue, aucune anomalie', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const received = new Date((await dbNow()).getTime() - 20_000).toISOString();
    const res = await pw.pay(
      keypad,
      pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000, { occurred_at: received }),
    );
    expect(res.status).toBe(201);
    expect(res.body.occurred_at).toBe(received);
    expect(
      await ownerRows('SELECT 1 FROM anomaly WHERE transaction_id = $1', [res.body.transaction_id]),
    ).toEqual([]);
  });

  it('A27 : époque périmée → 409 STALE_AUTHORITY_EPOCH avec l’époque courante ; en-tête absent → refusé ; rien d’écrit, numéro rangé', async () => {
    const [m] = (await pw.media(1)) as [PayMedia];
    const before = await pw.footprint(keypad.t.deviceId);
    const stale = await pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000), {
      epoch: '7',
    });
    const absent = await pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000), {
      epoch: null,
    });
    const junk = await pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000), {
      epoch: 'abc',
    });
    expect([stale.status, stale.body.code, stale.body.authority_epoch]).toEqual([
      409,
      'STALE_AUTHORITY_EPOCH',
      0,
    ]);
    // L'extension `authority_epoch` est déclarée au contrat (schéma Problem) : entier, époque courante. (`request_id`
    // est exigé par le schéma mais le serveur nomme ce membre `instance` : défaut antérieur, complété ici.)
    expect(contractViolations('Problem', { ...stale.body, request_id: randomUUID() })).toEqual([]);
    expect(
      contractViolations('Problem', {
        ...stale.body,
        authority_epoch: 'x',
        request_id: randomUUID(),
      }),
    ).not.toEqual([]);
    expect([absent.status, absent.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect([junk.status, junk.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    const after = await pw.footprint(keypad.t.deviceId);
    expect(after).toEqual({ ...before, rejected: before.rejected + 3 });
    expect(await pw.spendable(m.walletId)).toBe(20_000);
  });
});
