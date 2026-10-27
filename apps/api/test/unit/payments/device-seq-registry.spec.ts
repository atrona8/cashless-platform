// Registre des numéros : empreinte du contenu (mission 5b, lot WP11, T052 ; docs/sync_protocol.md §3.3,
// prioritaire). Les vecteurs ont été calculés HORS du code testé (JSON canonique trié sans espace, SHA-256 en
// Python) : la forme exacte est celle que les lots hors ligne (mission 7) devront reproduire.
import { createHash } from 'node:crypto';
import { ProblemException } from '../../../src/errors/problem';
import {
  isRegistrable,
  contentSha256,
  purchaseContent,
} from '../../../src/payments/device-seq-registry';
import { qrTokenHash } from '../../../src/payments/qr-token-hash';

const TAP = {
  nfc_uid: '04a1b2c3d4e5f6',
  token_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  counter: 413,
  key_index: 1,
  pack_verified: true,
  originality_signature: '3a7f0c9e5b2d4a6f8e1c3b5d7f9a0c2e4b6d8f0a1c3e5b7d9f0a2c4e6b8d0f1a',
  occurred_at: '2026-12-11T19:09:59Z',
};
const BODY = {
  amount: 6000,
  currency: 'XOF',
  occurred_at: '2026-12-11T19:10:00Z',
  tap: TAP,
  lines: [{ product_id: '9d1b7a4c-2e3f-4a5b-8c6d-7e8f9a0b1c2d', quantity: 2, unit_price: 3000 }],
};
const VECTOR_TAP = '3bea7bf24e0c18626e98856e8e5d20341b8103a00999b47206c357dc0d745c7b';
const VECTOR_KEYPAD = '24c53c208f16d9621bbee7294f00c1542db47b7e1007fa579f8c3382c48ef704';

describe('content_sha256 d’une vente (sync_protocol.md §3.3)', () => {
  it('vecteur fixe : lecture embarquée et lignes', () => {
    expect(purchaseContent(1n, BODY)!.toString('hex')).toBe(VECTOR_TAP);
  });

  it('vecteur fixe : montant saisi, sans lecture ni lignes (champs absents omis)', () => {
    const body = {
      amount: 4000,
      currency: 'XOF',
      occurred_at: '2026-12-11T20:05:00Z',
      customer_qr_token: 'CQ7M2K9XQ4TP',
      vendor_session_id: '2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b',
    };
    expect(purchaseContent(7n, body)!.toString('hex')).toBe(VECTOR_KEYPAD);
  });

  it('champs exclus : tap_id, customer_qr_token, vendor_session_id et tout champ d’état ne changent pas l’empreinte', () => {
    const base = purchaseContent(1n, BODY)!;
    for (const extra of [
      { tap_id: 99 },
      { customer_qr_token: 'CQ7M2K9XQ4TP' },
      { vendor_session_id: '2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b' },
      { snapshot_version: 12, config_id: 3, online_status: 'CONFIRMED', online_tap_id: 5 },
      { vendor_id: 'x', channel: 'NFC', device_id: 'y' },
    ])
      expect(purchaseContent(1n, { ...BODY, ...extra })!.equals(base)).toBe(true);
  });

  it('champs chaînés : le numéro, le type, le montant, la devise, l’heure, la lecture, les lignes comptent', () => {
    const base = purchaseContent(1n, BODY)!.toString('hex');
    const variants = [
      purchaseContent(2n, BODY),
      purchaseContent(1n, { ...BODY, amount: 6001 }),
      purchaseContent(1n, { ...BODY, currency: 'EUR' }),
      purchaseContent(1n, { ...BODY, occurred_at: '2026-12-11T19:10:01Z' }),
      purchaseContent(1n, { ...BODY, tap: { ...TAP, counter: 414 } }),
      purchaseContent(1n, { ...BODY, lines: [] }),
    ];
    for (const v of variants) expect(v!.toString('hex')).not.toBe(base);
  });

  it('l’ordre des clés du corps reçu est sans effet (forme canonique)', () => {
    const reordered = {
      lines: BODY.lines,
      tap: Object.fromEntries(Object.entries(TAP).reverse()),
      occurred_at: BODY.occurred_at,
      currency: 'XOF',
      amount: 6000,
    };
    expect(purchaseContent(1n, reordered)!.toString('hex')).toBe(VECTOR_TAP);
  });

  it('un corps qui n’est pas un objet n’a pas de contenu calculable', () => {
    for (const body of [null, [], 'x', 12, undefined]) expect(purchaseContent(1n, body)).toBeNull();
  });

  it('contentSha256 omet les champs absents et rend 32 octets', () => {
    expect(contentSha256({ a: 1, b: undefined }).equals(contentSha256({ a: 1 }))).toBe(true);
    expect(contentSha256({ a: 1 })).toHaveLength(32);
  });
});

describe('refus rangés au registre', () => {
  const problem = (code: string, status: number) => ({ code, status }) as never;

  it('refus définitifs 4xx : rangés', () => {
    for (const [code, status] of [
      ['INSUFFICIENT_FUNDS', 422],
      ['VENDOR_SESSION_INVALID', 409],
      ['TAP_UNUSABLE', 409],
      ['STALE_AUTHORITY_EPOCH', 409],
      ['QR_TOKEN_INVALID', 422],
    ] as const)
      expect(isRegistrable(problem(code, status), new ProblemException(code))).toBe(true);
  });

  it('non définitifs, 5xx et refus du registre lui-même : jamais rangés', () => {
    expect(isRegistrable(problem('DEBIT_AUTHORITY_EDGE', 409), new Error('x'))).toBe(false);
    expect(isRegistrable(problem('DEBIT_AUTHORITY_MOVING', 409), new Error('x'))).toBe(false);
    expect(isRegistrable(problem('INTERNAL_ERROR', 500), new Error('x'))).toBe(false);
    expect(isRegistrable(problem('SEQ_OUT_OF_RANGE', 409), { code: 'CL021' })).toBe(false);
    expect(isRegistrable(problem('IDEMPOTENCY_KEY_REUSED', 409), { code: 'CL002' })).toBe(false);
    // Le même code venu du moteur (autre contenu sous la même clé du grand livre) est un refus rangé.
    expect(
      isRegistrable(
        problem('IDEMPOTENCY_KEY_REUSED', 409),
        new ProblemException('IDEMPOTENCY_KEY_REUSED'),
      ),
    ).toBe(true);
  });
});

describe('qrTokenHash (NFR-008, réutilisée par WP13)', () => {
  it('SHA-256 des octets UTF-8 du jeton tel que reçu, sans normalisation', () => {
    expect(qrTokenHash('CQ7M2K9XQ4TP').toString('hex')).toBe(
      createHash('sha256').update(Buffer.from('CQ7M2K9XQ4TP', 'utf8')).digest('hex'),
    );
    expect(qrTokenHash('cq7m2k9xq4tp').equals(qrTokenHash('CQ7M2K9XQ4TP'))).toBe(false);
    expect(qrTokenHash(' CQ7M2K9XQ4TP').equals(qrTokenHash('CQ7M2K9XQ4TP'))).toBe(false);
    expect(qrTokenHash('é')).toHaveLength(32);
  });

  it('vecteur calculé hors du code : SHA-256("CQ7M2K9XQ4TP")', () => {
    expect(qrTokenHash('CQ7M2K9XQ4TP').toString('hex')).toBe(
      '4606403d0d1f0669bbed643ae79ce0d766893e8fbaac5b3bb0d4a882f7b70c86',
    );
  });
});
