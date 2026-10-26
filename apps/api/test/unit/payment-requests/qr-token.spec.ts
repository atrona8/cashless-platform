// Jetons des demandes de paiement QR (mission 5b, lot WP13, T061, T064 ; FR-018, FR-019, NFR-008).
import { createHash } from 'node:crypto';
import {
  CUSTOMER_TOKEN_ALPHABET,
  CUSTOMER_TOKEN_LENGTH,
  newCustomerToken,
  newMerchantToken,
  nonceHash,
} from '../../../src/payment-requests/qr-token';
import { qrTokenHash } from '../../../src/payments/qr-token-hash';

describe('jetons QR (WP13)', () => {
  it('commerçant : 128 bits en base64url (22 caractères), tous distincts', () => {
    const tokens = Array.from({ length: 2000 }, newMerchantToken);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // 16 octets : le dernier caractère ne porte que 4 bits significatifs.
      expect(Buffer.from(token, 'base64url')).toHaveLength(16);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('client : 12 caractères base32 (60 bits), alphabet fermé de 32 symboles sans I, L, O, U', () => {
    expect(CUSTOMER_TOKEN_ALPHABET).toHaveLength(32);
    expect(new Set(CUSTOMER_TOKEN_ALPHABET).size).toBe(32);
    expect(CUSTOMER_TOKEN_ALPHABET).not.toMatch(/[ILOU]/);
    const tokens = Array.from({ length: 2000 }, newCustomerToken);
    for (const token of tokens) {
      expect(token).toHaveLength(CUSTOMER_TOKEN_LENGTH);
      expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('client : tirage sans biais (chaque symbole vers 1/32 sur 120 000 tirages) et entropie nominale de 60 bits', () => {
    const counts = new Map<string, number>();
    let total = 0;
    for (let i = 0; i < 10_000; i += 1)
      for (const char of newCustomerToken()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
        total += 1;
      }
    expect(counts.size).toBe(32);
    const expected = total / 32;
    // Écart relatif borné à ±8 % (environ 5 écarts-types pour 3 750 occurrences attendues).
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.08);
    expect(CUSTOMER_TOKEN_LENGTH * Math.log2(CUSTOMER_TOKEN_ALPHABET.length)).toBe(60);
  });

  it('empreinte : SHA-256 des octets UTF-8 du jeton tel que reçu (32 octets), la même que celle de WP11', () => {
    const token = 'CQ7M2K9XQ4TP';
    expect(nonceHash(token)).toEqual(createHash('sha256').update(token, 'utf8').digest());
    expect(nonceHash(token)).toHaveLength(32);
    expect(nonceHash(token)).toEqual(qrTokenHash(token));
    // Aucune normalisation : la casse compte.
    expect(nonceHash(token.toLowerCase())).not.toEqual(nonceHash(token));
  });
});
