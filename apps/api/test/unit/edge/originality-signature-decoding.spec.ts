// La passerelle relaie `originality_signature` en hexadécimal (contrat `TapReading`, 64 caractères)
// : le central
// doit le décoder en 32 octets, pas en base64 (48 octets faux, preuve toujours refusée). Défaut
// trouvé par le banc
// à deux processus (WP25, T113).
import { createHash } from 'node:crypto';
import { decodeOriginalitySignature } from '../../../src/edge/sync/edge-sync.writer';

describe("décodage de la signature d'originalité relayée", () => {
  const raw = createHash('sha256').update('puce').digest();
  it('hexadécimal de 64 caractères : 32 octets, minuscules ou majuscules', () => {
    expect(decodeOriginalitySignature(raw.toString('hex'))?.equals(raw)).toBe(true);
    expect(decodeOriginalitySignature(raw.toString('hex').toUpperCase())?.equals(raw)).toBe(true);
  });
  it('base64 de 32 octets (forme antérieure) : 32 octets', () => {
    expect(decodeOriginalitySignature(raw.toString('base64'))?.equals(raw)).toBe(true);
  });
  it("autre chose : null (la preuve échoue, jamais d'exception)", () => {
    expect(decodeOriginalitySignature(undefined)).toBeNull();
    expect(decodeOriginalitySignature(42)).toBeNull();
    expect(decodeOriginalitySignature('pas du base64 !')).toBeNull();
  });
});
