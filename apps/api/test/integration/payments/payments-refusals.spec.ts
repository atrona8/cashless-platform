// Paiement : refus (mission 5b, lot WP11, T048 à T052, T054 ; FR-009 à FR-015, FR-019, FR-020, NFR-006,
// NFR-008 ; A1, A2, A4, A14, A17 ; contracts/payments.md). NFR-006 est vérifié sur CHAQUE refus : aucune vente,
// aucune ligne, aucune attribution, passage non consommé (et, pour une lecture embarquée, non enregistré), solde
// intact, et le numéro rangé au registre `REJECTED` avec le code du problème — sauf les refus NON définitifs
// (`DEBIT_AUTHORITY_EDGE`) et ceux du registre lui-même (`CL002`, `CL021`), qui ne laissent rien.
// Les états difficiles à obtenir par la route (bracelet suspendu, portefeuille bloqué, jeton expiré, autorité
// de débit) sont posés par le propriétaire : AMORÇAGE seulement, remis en état dans `finally`.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contentSha256 } from '../../../src/payments/device-seq-registry';
import { qrTokenHash } from '../../../src/payments/qr-token-hash';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import type { TerminalResponse } from '../../support/test-terminal';
import { asOperator } from '../vendors/vendor-fixtures';
import { PaymentWorld, type PayMedia, type PayTerminal } from './payments-fixtures';

jest.setTimeout(240_000);

/** Problème sans ce qui varie d'une requête à l'autre. */
const stable = (body: Record<string, unknown>) => {
  const { instance: _i, request_id: _r, ...rest } = body;
  return rest;
};

describe('createPayment : refus (WP11)', () => {
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

  const media = async (funds = 20_000): Promise<PayMedia> => (await pw.media(1, funds))[0]!;

  /**
   * Un refus définitif : statut et code attendus, rien d'écrit (NFR-006), solde intact, et le numéro rangé
   * `REJECTED` avec le code (`registered: true`). Rend la réponse pour les contrôles propres au cas.
   */
  async function refused(
    term: PayTerminal,
    wallets: string[],
    send: () => Promise<TerminalResponse>,
    expected: [number, string],
    options: { registered?: boolean; tapsRecorded?: number } = {},
  ): Promise<TerminalResponse> {
    const before = await pw.footprint(term.t.deviceId);
    const funds = await Promise.all(wallets.map((w) => pw.spendable(w)));
    const res = await send();
    expect([res.status, res.body.code]).toEqual(expected);
    const registered = options.registered ?? true;
    const after = await pw.footprint(term.t.deviceId);
    expect(after).toEqual({
      ...before,
      rejected: before.rejected + (registered ? 1 : 0),
      taps: before.taps + (options.tapsRecorded ?? 0),
    });
    expect(await Promise.all(wallets.map((w) => pw.spendable(w)))).toEqual(funds);
    if (registered) {
      const last = (await pw.registry(term.t.deviceId)).at(-1)!;
      expect(last).toMatchObject({
        outcome: 'REJECTED',
        reason: expected[1],
        transaction_id: null,
        channel: 'ONLINE',
      });
    }
    return res;
  }

  const suspend = (mediaId: string) =>
    ownerRows("UPDATE media SET status = 'SUSPENDED' WHERE id = $1 RETURNING id", [mediaId]);
  const blockWallet = (walletId: string, status: string) =>
    ownerRows('UPDATE wallet SET status = $2 WHERE id = $1 RETURNING id', [walletId, status]);

  it('INSUFFICIENT_FUNDS : 422 avec le solde disponible et la devise (lecture embarquée)', async () => {
    const m = await media(1000);
    const res = await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 6000)),
      [422, 'INSUFFICIENT_FUNDS'],
    );
    expect(res.body).toMatchObject({ available_balance: 1000, currency: 'XOF', status: 422 });
  });

  it('MEDIA_BLOCKED par lecture embarquée : bracelet suspendu → 422, la lecture n’est pas enregistrée', async () => {
    const m = await media();
    await suspend(m.media.id);
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) })),
      [422, 'MEDIA_BLOCKED'],
    );
  });

  it('A1 — MEDIA_BLOCKED par tap_id : bracelet suspendu APRÈS la lecture → 422, la lecture n’est pas consommée', async () => {
    const m = await media();
    const tapId = await pw.readTap(keypad, m);
    await suspend(m.media.id);
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap_id: tapId })),
      [422, 'MEDIA_BLOCKED'],
    );
    expect(await ownerRows('SELECT transaction_id FROM media_tap WHERE id = $1', [tapId])).toEqual([
      { transaction_id: null },
    ]);
  });

  it('A17 — WALLET_BLOCKED : portefeuille bloqué, par lecture embarquée et par tap_id → 422 ; par QR → jeton invalide', async () => {
    const m = await media();
    const tapId = await pw.readTap(keypad, m);
    await blockWallet(m.walletId, 'BLOCKED');
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) })),
      [422, 'WALLET_BLOCKED'],
    );
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap_id: tapId })),
      [422, 'WALLET_BLOCKED'],
    );
    await blockWallet(m.walletId, 'ACTIVE');
    const token = await pw.customerQr(m.walletId);
    await blockWallet(m.walletId, 'BLOCKED');
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { customer_qr_token: token })),
      [422, 'QR_TOKEN_INVALID'],
    );
    await blockWallet(m.walletId, 'ACTIVE');
  });

  it('lecture suspecte (signature d’originalité fausse) : 422 MEDIA_SIGNATURE_MISMATCH, aucune vente, numéro rangé, et l’anomalie de la lecture survit (rejouée seule)', async () => {
    const m = await media();
    const forged = pw.tap(m);
    forged.originality_signature = 'ab'.repeat(32);
    const res = await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap: forged })),
      [422, 'MEDIA_SIGNATURE_MISMATCH'],
    );
    expect(res.body.code).toBe('MEDIA_SIGNATURE_MISMATCH');
    expect(
      await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND kind = 'SIGNATURE_MISMATCH'`,
        [m.media.id],
      ),
    ).toEqual([{ n: 1 }]);
  });

  it('constat 1 — lecture falsifiée sur un numéro déjà rangé avec un autre contenu : 409 du registre ET une anomalie SIGNATURE_MISMATCH', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const m = await media();
    // Le numéro 1 est déjà rangé (hors idempotence de l'API) avec un autre contenu : `record_device_seq` lèvera
    // CL002 au rangement du refus ; la consignation de la lecture suspecte ne doit pas en dépendre.
    await withOwner((db) =>
      asOperator(db, pw.w.ops.a, () =>
        db.query(
          `SELECT record_device_seq($1, 1, $2, 'REJECTED', 'ONLINE', NULL, 'VALIDATION_FAILED')`,
          [term.t.deviceId, contentSha256({ autre: 'contenu' })],
        ),
      ),
    );
    const before = await pw.footprint(term.t.deviceId);
    const forged = pw.tap(m);
    forged.originality_signature = 'ab'.repeat(32);
    const res = await pw.pay(term, pw.keypadBody(term, { tap: forged }, 1000));
    expect([res.status, res.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect(
      await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND kind = 'SIGNATURE_MISMATCH'`,
        [m.media.id],
      ),
    ).toEqual([{ n: 1 }]);
    expect(await pw.footprint(term.t.deviceId)).toEqual(before);
    expect(await pw.spendable(m.walletId)).toBe(20_000);
  });

  it('EVENT_CLOSING : grand livre en clôture → refus, rien d’écrit', async () => {
    const m = await media();
    await ownerRows("UPDATE ledger SET status = 'CLOSING' WHERE id = $1 RETURNING id", [
      pw.w.ids.ledgerA,
    ]);
    try {
      const res = await refused(
        keypad,
        [m.walletId],
        () => pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) })),
        [409, 'EVENT_CLOSING'],
      );
      expect(res.body.status).toBe(409);
    } finally {
      await ownerRows("UPDATE ledger SET status = 'OPEN' WHERE id = $1 RETURNING id", [
        pw.w.ids.ledgerA,
      ]);
    }
  });

  it('A1, A18 — TAP_UNUSABLE : lecture consommée, trop ancienne, d’un autre terminal, inconnue → 409', async () => {
    const m = await media();
    // Consommée par une première vente.
    const used = await pw.readTap(keypad, m);
    expect((await pw.pay(keypad, pw.keypadBody(keypad, { tap_id: used }, 1000))).status).toBe(201);
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap_id: used }, 1000)),
      [409, 'TAP_UNUSABLE'],
    );
    // Trop ancienne : reçue il y a une heure (fenêtre de 120 s, heure de la base).
    const old = await pw.readTap(keypad, m);
    await ownerRows(
      "UPDATE media_tap SET received_at = received_at - interval '1 hour' WHERE id = $1 RETURNING id",
      [old],
    );
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap_id: old }, 1000)),
      [409, 'TAP_UNUSABLE'],
    );
    // Lue par un AUTRE terminal.
    const foreign = await pw.readTap(bar, m);
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap_id: foreign }, 1000)),
      [409, 'TAP_UNUSABLE'],
    );
    expect(
      await ownerRows('SELECT transaction_id FROM media_tap WHERE id = $1', [foreign]),
    ).toEqual([{ transaction_id: null }]);
    // Inconnue.
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap_id: 987_654_321 }, 1000)),
      [409, 'TAP_UNUSABLE'],
    );
  });

  it('A2 — SALE_LINES_INVALID : prix d’une version servie puis remplacée → 422', async () => {
    const { pos, items, vendorId } = await pw.newPos([['Thé', 'Tea', 800]]);
    const term = await pw.terminal({ mode: 'CATALOG_POS', posId: pos.posId, vendorId });
    const item = items[0]!;
    const m = await media();
    await pw.serveCatalog(term.t.deviceId); // v1 servie : 800
    await pw.setPrice(item.id, 900); // v2 courante
    await pw.serveCatalog(term.t.deviceId); // v2 servie : l'ancien prix n'est plus ni courant ni servi
    await pw.setPrice(item.id, 1000); // v3 courante, v2 servie
    const sale = (price: number) => ({
      amount: price,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      vendor_session_id: term.sessionId,
      lines: [{ product_id: item.id, quantity: 1, unit_price: price }],
      tap: pw.tap(m),
    });
    await refused(term, [m.walletId], () => pw.pay(term, sale(800)), [422, 'SALE_LINES_INVALID']);
    expect((await pw.pay(term, sale(900))).status).toBe(201); // servi
    expect((await pw.pay(term, sale(1000))).status).toBe(201); // courant
  });

  it('VALIDATION_FAILED : somme fausse, lignes sur un TPE simplifié, absence de lignes sur une caisse, devise autre que celle de l’événement', async () => {
    const m = await media();
    await refused(
      bar,
      [m.walletId],
      () => pw.pay(bar, pw.catalogBody(bar, { tap: pw.tap(m) }, [[0, 2]], { amount: 5999 })),
      [422, 'VALIDATION_FAILED'],
    );
    await refused(
      keypad,
      [m.walletId],
      () =>
        pw.pay(
          keypad,
          pw.keypadBody(keypad, { tap: pw.tap(m) }, 3000, {
            lines: [{ product_id: pw.items[0]!.id, quantity: 1, unit_price: 3000 }],
          }),
        ),
      [422, 'VALIDATION_FAILED'],
    );
    await refused(
      bar,
      [m.walletId],
      () => pw.pay(bar, pw.keypadBody(bar, { tap: pw.tap(m) }, 3000)),
      [422, 'VALIDATION_FAILED'],
    );
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 3000, { currency: 'EUR' })),
      [422, 'CURRENCY_MISMATCH'],
    );
  });

  it('VENDOR_SESSION_INVALID : session absente, inconnue, d’un autre terminal, close → 409', async () => {
    const m = await media();
    const other = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const closed = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const closedId = closed.sessionId;
    const closeRes = await closed.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
      method: 'DELETE',
      path: '/vendor-sessions/current',
      idempotencyKey: randomUUID(),
    });
    expect(closeRes.status).toBe(204);
    const withSession = (id: string | null) =>
      pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000, { vendor_session_id: id ?? undefined });
    for (const id of [null, randomUUID(), other.sessionId, closedId])
      await refused(keypad, [m.walletId], () => pw.pay(keypad, withSession(id)), [
        409,
        'VENDOR_SESSION_INVALID',
      ]);
    // Identifiant qui n'est pas un UUID : 422 avant toute requête.
    await refused(
      keypad,
      [m.walletId],
      () =>
        pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000, { vendor_session_id: 'x' })),
      [422, 'VALIDATION_FAILED'],
    );
  });

  it('FR-015 — DEVICE_MODE_NOT_ALLOWED : bracelet depuis un iOS ou un NFC coupé, TOPUP_DESK, payment_intent_id', async () => {
    const m = await media();
    const ios = await pw.terminal({ os: 'IOS', mode: 'KEYPAD_TPE' });
    const noNfc = await pw.terminal({ mode: 'KEYPAD_TPE', nfcEnabled: false });
    const desk = await pw.terminal({ mode: 'TOPUP_DESK', session: false });
    const tapId = await pw.readTap(keypad, m);
    const body = (t: PayTerminal, means: Record<string, unknown>) => pw.keypadBody(t, means, 1000);
    await refused(ios, [m.walletId], () => pw.pay(ios, body(ios, { tap: pw.tap(m) })), [
      422,
      'DEVICE_MODE_NOT_ALLOWED',
    ]);
    await refused(ios, [m.walletId], () => pw.pay(ios, body(ios, { tap_id: tapId })), [
      422,
      'DEVICE_MODE_NOT_ALLOWED',
    ]);
    await refused(noNfc, [m.walletId], () => pw.pay(noNfc, body(noNfc, { tap: pw.tap(m) })), [
      422,
      'DEVICE_MODE_NOT_ALLOWED',
    ]);
    desk.sessionId = randomUUID();
    await refused(desk, [m.walletId], () => pw.pay(desk, body(desk, { tap: pw.tap(m) })), [
      422,
      'DEVICE_MODE_NOT_ALLOWED',
    ]);
    // C-007 : payment_intent_id est V2.
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, body(keypad, { payment_intent_id: 'pi_123' })),
      [422, 'DEVICE_MODE_NOT_ALLOWED'],
    );
  });

  it('VALIDATION_FAILED : zéro, deux moyens ou montant fractionnaire ; un corps qui n’est pas un objet n’est pas rangé au registre', async () => {
    const m = await media();
    const base = pw.keypadBody(keypad, {}, 1000);
    await refused(keypad, [m.walletId], () => pw.pay(keypad, base), [422, 'VALIDATION_FAILED']);
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, { ...base, tap: pw.tap(m), tap_id: 1 }),
      [422, 'VALIDATION_FAILED'],
    );
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, { ...base, tap: pw.tap(m), amount: 10.5 }),
      [400, 'VALIDATION_FAILED'],
    );
    // Aucun contenu calculable : refus final, mais le numéro n'est pas rangé.
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, [1, 2, 3]),
      [400, 'VALIDATION_FAILED'],
      {
        registered: false,
      },
    );
  });

  it('FR-020 — QR inconnu, expiré, déjà utilisé : 422 QR_TOKEN_INVALID, même corps', async () => {
    const m = await media();
    const expired = await pw.customerQr(m.walletId);
    await ownerRows(
      "UPDATE payment_request SET expires_at = clock_timestamp() - interval '1 minute' WHERE nonce_hash = $1 RETURNING id",
      [qrTokenHash(expired)],
    );
    const used = await pw.customerQr(m.walletId);
    expect(
      (await pw.pay(keypad, pw.keypadBody(keypad, { customer_qr_token: used }, 1000))).status,
    ).toBe(201);
    const cancelled = await pw.customerQr(m.walletId);
    await ownerRows(
      "UPDATE payment_request SET status = 'CANCELLED' WHERE nonce_hash = $1 RETURNING id",
      [qrTokenHash(cancelled)],
    );
    const bodies = new Set<string>();
    for (const token of ['INCONNU12CHAR', expired, used, cancelled]) {
      const res = await refused(
        keypad,
        [m.walletId],
        () => pw.pay(keypad, pw.keypadBody(keypad, { customer_qr_token: token }, 1000)),
        [422, 'QR_TOKEN_INVALID'],
      );
      expect(res.text).not.toContain(token);
      bodies.add(JSON.stringify(stable(res.body)));
    }
    expect(bodies.size).toBe(1);
  });

  it('QR d’un autre événement → 422 QR_TOKEN_INVALID (même corps)', async () => {
    const m = await media();
    const token = await pw.customerQr(m.walletId);
    const other = await withOwner(async (db) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $1, operator_id, organizer_id, 'Autre événement', currency, timezone, jurisdiction_id, funds_holder
           FROM event WHERE id = $2`,
        [id, pw.w.ids.eventA],
      );
      return id;
    });
    await ownerRows('UPDATE payment_request SET event_id = $2 WHERE nonce_hash = $1 RETURNING id', [
      qrTokenHash(token),
      other,
    ]);
    await refused(
      keypad,
      [m.walletId],
      () => pw.pay(keypad, pw.keypadBody(keypad, { customer_qr_token: token }, 1000)),
      [422, 'QR_TOKEN_INVALID'],
    );
  });

  it('A14 — DEBIT_AUTHORITY_EDGE : refus non définitif, rien au registre, la même clé est rejouable', async () => {
    const m = await media();
    const key = keypad.t.seqKey();
    const body = pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000);
    await ownerRows("UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1 RETURNING id", [
      pw.w.ids.ledgerA,
    ]);
    let res: TerminalResponse;
    try {
      res = await refused(
        keypad,
        [m.walletId],
        () => pw.pay(keypad, body, { key }),
        [409, 'DEBIT_AUTHORITY_EDGE'],
        { registered: false },
      );
    } finally {
      await ownerRows("UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1 RETURNING id", [
        pw.w.ids.ledgerA,
      ]);
    }
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(
      (await pw.registry(keypad.t.deviceId)).filter(
        (r) => r.seq === String(Number(key.split(':')[1])),
      ),
    ).toEqual([]);
    // Même clé, même corps : la clé a été relâchée, la vente passe.
    const again = await pw.pay(keypad, body, { key });
    expect(again.status).toBe(201);
    expect(again.headers['idempotency-replayed']).toBeUndefined();
  });

  it('A4 — refus du registre : même numéro avec un autre contenu → 409 tel quel, hors plage → 409, rien d’écrit ni rangé', async () => {
    const m = await media();
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    // Le numéro 1 est déjà rangé par le propriétaire avec un autre contenu.
    await withOwner((db) =>
      asOperator(db, pw.w.ops.a, () =>
        db.query(
          `SELECT record_device_seq($1, 1, $2, 'REJECTED', 'ONLINE', NULL, 'VALIDATION_FAILED')`,
          [term.t.deviceId, contentSha256({ autre: 'contenu' })],
        ),
      ),
    );
    const before = await pw.footprint(term.t.deviceId);
    const same = await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000));
    expect([same.status, same.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    const far = await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000), {
      key: `${term.t.serial}:20000`,
    });
    expect([far.status, far.body.code]).toEqual([409, 'SEQ_OUT_OF_RANGE']);
    expect(await pw.footprint(term.t.deviceId)).toEqual(before);
    expect((await pw.registry(term.t.deviceId)).map((r) => r.seq)).toEqual(['1']);
    expect(await pw.spendable(m.walletId)).toBe(20_000);
  });

  it('constat 3 de WP08 — seq au-delà de 2^63 − 1 : 422 avant toute écriture, rien rangé', async () => {
    const m = await media();
    const before = await pw.footprint(keypad.t.deviceId);
    const res = await pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000), {
      key: `${keypad.t.serial}:9223372036854775808`,
    });
    expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(await pw.footprint(keypad.t.deviceId)).toEqual(before);
  });

  it('terminal sans preuve de clé : « <serial>:<seq> » d’un autre numéro de série → 422, rien rangé', async () => {
    const m = await media();
    const before = await pw.footprint(keypad.t.deviceId);
    const res = await pw.pay(keypad, pw.keypadBody(keypad, { tap: pw.tap(m) }, 1000), {
      key: `AUTRE-SERIE:0001`,
    });
    expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(await pw.footprint(keypad.t.deviceId)).toEqual(before);
  });
});
