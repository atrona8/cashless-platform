// Unitaires : vérification des jetons d'accès et d'approbation (R-01, R-09, R-11 A2) avec le faux serveur.
import { errors } from 'jose';
import { IdentityError, JoseIdentityVerifier } from '../../../src/identity/oidc-verifier';
import { DEFECTIVE_KINDS, FakeIdp } from '../../support/fake-idp';

describe('JoseIdentityVerifier', () => {
  let idp: FakeIdp;
  let verifier: JoseIdentityVerifier;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    verifier = idp.verifier();
  });

  it('jeton d’accès valide : émetteur, sujet, échéance et claim operator_id', async () => {
    const token = await idp.accessToken('alice', { operator_id: 'op-1', roles: ['PLATFORM_ADMIN'] });
    const verified = await verifier.verifyAccess(token);
    expect(verified).toMatchObject({ issuer: idp.config.issuer, subject: 'alice', operatorClaim: 'op-1' });
    expect(verified.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Les rôles annoncés par le jeton ne sont pas exposés (R-11 A3).
    expect(verified).not.toHaveProperty('roles');
  });

  it.each(DEFECTIVE_KINDS)('jeton défectueux « %s » : INVALID', async (kind) => {
    const token = await idp.defective(kind, 'alice');
    await expect(verifier.verifyAccess(token)).rejects.toMatchObject({ name: 'IdentityError', kind: 'INVALID' });
  });

  it('jeton d’approbation présenté comme jeton d’accès (autre audience) : INVALID', async () => {
    const token = await idp.approvalToken({ subject: 'bob', act: 'adjustLedger', actHash: 'abc' });
    await expect(verifier.verifyAccess(token)).rejects.toMatchObject({ kind: 'INVALID' });
  });

  it('jeton d’approbation valide : jti, act, act_hash', async () => {
    const token = await idp.approvalToken({ subject: 'bob', act: 'adjustLedger', actHash: 'abc', jti: 'j-1' });
    await expect(verifier.verifyApproval(token)).resolves.toMatchObject({
      subject: 'bob',
      jti: 'j-1',
      act: 'adjustLedger',
      actHash: 'abc',
    });
  });

  it('jeton d’approbation de plus de 300 s : INVALID', async () => {
    const token = await idp.approvalToken({ subject: 'bob', act: 'adjustLedger', actHash: 'abc', ttlSeconds: 301 });
    await expect(verifier.verifyApproval(token)).rejects.toMatchObject({ kind: 'INVALID' });
  });

  it('jeton d’accès présenté comme jeton d’approbation : INVALID', async () => {
    await expect(verifier.verifyApproval(await idp.accessToken('bob'))).rejects.toMatchObject({ kind: 'INVALID' });
  });

  it('clés publiques injoignables (délai dépassé, erreur réseau) : UNAVAILABLE', async () => {
    const token = await idp.accessToken('alice');
    const timeout = new JoseIdentityVerifier(() => Promise.reject(new errors.JWKSTimeout()), idp.config);
    await expect(timeout.verifyAccess(token)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    const network = new JoseIdentityVerifier(() => Promise.reject(new TypeError('fetch failed')), idp.config);
    await expect(network.verifyAccess(token)).rejects.toBeInstanceOf(IdentityError);
    await expect(network.verifyAccess(token)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('clé inconnue dans la JWKS : INVALID (pas une indisponibilité)', async () => {
    const token = await idp.accessToken('alice');
    const noKey = new JoseIdentityVerifier(() => Promise.reject(new errors.JWKSNoMatchingKey()), idp.config);
    await expect(noKey.verifyAccess(token)).rejects.toMatchObject({ kind: 'INVALID' });
  });
});
