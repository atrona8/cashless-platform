// Unitaires : empreinte act_hash du jeton d'approbation sur place (contracts/approvals.md).
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { actHash, requestActHash, sameHash } from '../../../src/approval/onsite/act-hash';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('actHash', () => {
  it('vecteur fixe : méthode en majuscules, chemin réel, corps en JSON canonique', () => {
    expect(actHash('post', '/v1/cash-sessions/7c0e1a52/refunds', { amount: 1500, wallet_id: 'w-1' })).toBe(
      sha256('POST\n/v1/cash-sessions/7c0e1a52/refunds\n{"amount":1500,"wallet_id":"w-1"}'),
    );
    expect(actHash('POST', '/v1/x', { a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ordre des clés indifférent (JCS)', () => {
    expect(actHash('POST', '/v1/x', { b: 2, a: { d: 1, c: [3, 1] } })).toBe(actHash('POST', '/v1/x', { a: { c: [3, 1], d: 1 }, b: 2 }));
  });

  it('corps absent = null', () => {
    expect(actHash('POST', '/v1/x', undefined)).toBe(sha256('POST\n/v1/x\nnull'));
    expect(actHash('POST', '/v1/x', null)).toBe(actHash('POST', '/v1/x', undefined));
  });

  it('chemin réel différent → empreinte différente ; chaîne de requête ignorée', () => {
    expect(actHash('POST', '/v1/wallets/a/refunds', {})).not.toBe(actHash('POST', '/v1/wallets/b/refunds', {}));
    const req = (url: string, body: unknown, length?: string) =>
      ({ method: 'POST', originalUrl: url, body, headers: length === undefined ? {} : { 'content-length': length } }) as unknown as Request;
    expect(requestActHash(req('/v1/x?debug=1', { a: 1 }, '7'))).toBe(actHash('POST', '/v1/x', { a: 1 }));
    // Requête sans corps : `{}` posé par l'analyseur n'est pas un corps.
    expect(requestActHash(req('/v1/x', {}))).toBe(actHash('POST', '/v1/x', null));
  });

  it('comparaison en temps constant', () => {
    expect(sameHash('abc', 'abc')).toBe(true);
    expect(sameHash('abc', 'abd')).toBe(false);
    expect(sameHash('abc', 'abcd')).toBe(false);
  });
});
