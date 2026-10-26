// Corps de `createPayment` (mission 5b, lot WP11, T048 à T050, T054 ; FR-006, FR-009 à FR-012, C-007, NFR-008).
import { ProblemException } from '../../../src/errors/problem';
import { linesJson, parsePayment } from '../../../src/payments/payments.dto';

const UUID = '2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b';
const PRODUCT = '9d1b7a4c-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const TAP = {
  nfc_uid: '04a1b2c3d4e5f6',
  token_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  counter: 413,
  key_index: 1,
  pack_verified: true,
  occurred_at: '2026-12-11T19:09:59Z',
};
const base = (extra: Record<string, unknown> = {}) => ({
  amount: 6000,
  currency: 'XOF',
  occurred_at: '2026-12-11T19:10:00Z',
  vendor_session_id: UUID,
  ...extra,
});
const failure = (raw: unknown): string => {
  try {
    parsePayment(raw);
  } catch (error) {
    return error instanceof ProblemException ? `${error.status} ${error.code}` : String(error);
  }
  return 'accepté';
};

describe('parsePayment', () => {
  it('lecture embarquée avec lignes : montant en bigint, lignes lues', () => {
    const input = parsePayment(
      base({ tap: TAP, lines: [{ product_id: PRODUCT, quantity: 2, unit_price: 3000 }] }),
    );
    expect(input.amount).toBe(6000n);
    expect(input.means.kind).toBe('tap');
    expect(input.vendorSessionId).toBe(UUID);
    expect(input.lines).toEqual([{ productId: PRODUCT, quantity: 2, unitPrice: 3000n }]);
    expect(JSON.parse(linesJson(input.lines!))).toEqual([
      { product_id: PRODUCT, quantity: 2, unit_price: 3000 },
    ]);
  });

  it('tap_id et QR client : un seul moyen chacun, sans lignes', () => {
    expect(parsePayment(base({ tap_id: 17 })).means).toEqual({ kind: 'tap_id', tapId: 17n });
    expect(parsePayment(base({ customer_qr_token: 'CQ7M2K9XQ4TP' })).means).toEqual({
      kind: 'customer_qr',
      token: 'CQ7M2K9XQ4TP',
    });
    expect(parsePayment(base({ tap_id: 17 })).lines).toBeNull();
  });

  it('exactement un moyen : aucun ou plusieurs → 422', () => {
    expect(failure(base())).toBe('422 VALIDATION_FAILED');
    expect(failure(base({ tap: TAP, tap_id: 1 }))).toBe('422 VALIDATION_FAILED');
    expect(failure(base({ tap_id: 1, customer_qr_token: 'CQ7M2K9XQ4TP' }))).toBe(
      '422 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, payment_intent_id: 'pi_1' }))).toBe('422 VALIDATION_FAILED');
  });

  it('C-007 : payment_intent_id seul → 422 DEVICE_MODE_NOT_ALLOWED', () => {
    expect(failure(base({ payment_intent_id: 'pi_123' }))).toBe('422 DEVICE_MODE_NOT_ALLOWED');
  });

  it('montants : entiers sûrs ≥ 1 ; fractionnaire, chaîne, zéro, négatif, trop grand refusés', () => {
    for (const amount of [0, -5, 10.5, '6000', null, 2 ** 53, Number.NaN])
      expect(failure(base({ tap_id: 1, amount }))).toMatch(/^(400|422) VALIDATION_FAILED$/);
    expect(failure(base({ tap_id: 1, amount: Number.MAX_SAFE_INTEGER }))).toBe('accepté');
    expect(parsePayment(base({ tap_id: 1, amount: Number.MAX_SAFE_INTEGER })).amount).toBe(
      9007199254740991n,
    );
  });

  it('devise et heure : formes du contrat', () => {
    expect(failure(base({ tap_id: 1, currency: 'xof' }))).toBe('400 VALIDATION_FAILED');
    expect(failure(base({ tap_id: 1, currency: 'XOFX' }))).toBe('400 VALIDATION_FAILED');
    expect(failure(base({ tap_id: 1, occurred_at: 'hier' }))).toBe('400 VALIDATION_FAILED');
    expect(failure({ tap_id: 1, amount: 1, currency: 'XOF' })).toBe('400 VALIDATION_FAILED');
  });

  it('vendor_session_id : absent → null (la garde de session répond 409) ; mal formé → 422', () => {
    expect(
      parsePayment({ ...base({ tap_id: 1 }), vendor_session_id: undefined }).vendorSessionId,
    ).toBeNull();
    expect(failure(base({ tap_id: 1, vendor_session_id: 'abc' }))).toBe('422 VALIDATION_FAILED');
    expect(failure(base({ tap_id: 1, vendor_session_id: 12 }))).toBe('422 VALIDATION_FAILED');
  });

  it('le vendeur, le canal, le terminal et le prestataire du corps ne sont jamais lus', () => {
    const input = parsePayment(
      base({ tap_id: 1, vendor_id: 'x', channel: 'MERCHANT_QR', device_id: 'y', operator_id: 'z' }),
    );
    expect(Object.keys(input).sort()).toEqual(
      ['amount', 'currency', 'lines', 'means', 'occurredAt', 'vendorSessionId'].sort(),
    );
  });

  it('lignes : somme = montant, sinon 422 ; product_id requis ; quantité ≥ 1 ; au plus 200 lignes', () => {
    const line = (extra: Record<string, unknown> = {}) => ({
      product_id: PRODUCT,
      quantity: 2,
      unit_price: 3000,
      ...extra,
    });
    expect(failure(base({ tap_id: 1, amount: 5999, lines: [line()] }))).toBe(
      '422 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, lines: [line({ product_id: undefined })] }))).toBe(
      '422 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, lines: [line({ product_id: 'x' })] }))).toBe(
      '422 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, lines: [line({ quantity: 0 })] }))).toBe(
      '422 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, lines: [line({ quantity: 1.5 })] }))).toBe(
      '400 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, lines: [line({ unit_price: 0 })] }))).toBe(
      '422 VALIDATION_FAILED',
    );
    expect(failure(base({ tap_id: 1, lines: [] }))).toBe('422 VALIDATION_FAILED');
    expect(failure(base({ tap_id: 1, lines: 'x' }))).toBe('400 VALIDATION_FAILED');
    expect(failure(base({ tap_id: 1, lines: null }))).toBe('400 VALIDATION_FAILED');
    expect(
      failure(
        base({
          tap_id: 1,
          amount: 200,
          lines: Array.from({ length: 201 }, () => line({ quantity: 1, unit_price: 1 })),
        }),
      ),
    ).toBe('422 VALIDATION_FAILED');
    // Somme en bigint : exacte jusqu'à la borne des entiers sûrs.
    expect(
      failure(
        base({
          tap_id: 1,
          amount: Number.MAX_SAFE_INTEGER,
          lines: [
            line({ quantity: 1, unit_price: 9_007_199_254_740_990 }),
            line({ quantity: 1, unit_price: 1 }),
          ],
        }),
      ),
    ).toBe('accepté');
  });

  it('« label » d’une ligne est ignoré (réservé aux relevés) et n’est pas transmis à la base', () => {
    const input = parsePayment(
      base({
        tap_id: 1,
        lines: [{ product_id: PRODUCT, quantity: 2, unit_price: 3000, label: 'Pirate' }],
      }),
    );
    expect(linesJson(input.lines!)).not.toContain('Pirate');
  });

  it('NFR-008 : un jeton QR mal formé n’est pas recopié dans le refus', () => {
    const secret = 'ABC';
    try {
      parsePayment(base({ customer_qr_token: secret }));
      throw new Error('accepté');
    } catch (error) {
      const text = JSON.stringify([(error as ProblemException).detail, (error as Error).message]);
      expect(text).not.toContain(secret);
    }
    expect(failure(base({ customer_qr_token: 'a'.repeat(65) }))).toBe('400 VALIDATION_FAILED');
    expect(failure(base({ customer_qr_token: 12345 }))).toBe('400 VALIDATION_FAILED');
  });

  it('corps qui n’est pas un objet → 400', () => {
    for (const raw of [null, [], 'x', 3]) expect(failure(raw)).toBe('400 VALIDATION_FAILED');
  });
});
