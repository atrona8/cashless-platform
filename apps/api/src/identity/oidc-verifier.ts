// Vérification des jetons OIDC (contracts/identity.md « Jeton d'accès », research R-01, R-09, R-11).
// Port `IdentityVerifier` : implémentation `jose` en production (JWKS distante), JWKS locale en test (faux serveur).
// Le jeton ne prouve que l'identité (iss, sub) : les rôles annoncés ne sont jamais lus (R-11 A3).
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { OidcConfig } from '../config/config';

export const IDENTITY_VERIFIER = Symbol('IDENTITY_VERIFIER');

/** Algorithmes admis : asymétriques seulement (ni `none`, ni HMAC). */
export const ALLOWED_ALGORITHMS = ['RS256', 'ES256'];
/** Durée de vie maximale d'un jeton d'approbation sur place (R-09). */
export const APPROVAL_TOKEN_MAX_SECONDS = 300;

export interface VerifiedToken {
  issuer: string;
  subject: string;
  tokenId?: string;
  /** Claim `operator_id` facultatif : comparé au prestataire de la personne, jamais utilisé seul. */
  operatorClaim?: string;
  expiresAt: Date;
}

export interface VerifiedApprovalToken extends VerifiedToken {
  jti: string;
  act: string;
  actHash: string;
  issuedAt: Date;
}

export interface IdentityVerifier {
  verifyAccess(token: string): Promise<VerifiedToken>;
  verifyApproval(token: string): Promise<VerifiedApprovalToken>;
}

/** `INVALID` : jeton refusé (401/403) ; `UNAVAILABLE` : clés publiques injoignables (503, jamais d'acceptation). */
export class IdentityError extends Error {
  constructor(
    readonly kind: 'INVALID' | 'UNAVAILABLE',
    options?: { cause?: unknown },
  ) {
    super(`Jeton ${kind === 'INVALID' ? 'invalide' : 'invérifiable : clés publiques injoignables'}`, options);
    this.name = 'IdentityError';
  }
}

export class JoseIdentityVerifier implements IdentityVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly config: OidcConfig,
  ) {}

  async verifyAccess(token: string): Promise<VerifiedToken> {
    return verified(await this.verify(token, this.config.audience, ['exp', 'sub']));
  }

  async verifyApproval(token: string): Promise<VerifiedApprovalToken> {
    const payload = await this.verify(token, this.config.approvalAudience, ['exp', 'sub', 'iat', 'jti', 'act', 'act_hash']);
    const { jti, act, act_hash: actHash, iat, exp } = payload;
    if (typeof jti !== 'string' || jti === '' || typeof act !== 'string' || act === '' || typeof actHash !== 'string') {
      throw new IdentityError('INVALID');
    }
    if (typeof iat !== 'number' || typeof exp !== 'number' || exp - iat > APPROVAL_TOKEN_MAX_SECONDS) {
      throw new IdentityError('INVALID');
    }
    return { ...verified(payload), jti, act, actHash, issuedAt: new Date(iat * 1000) };
  }

  private async verify(token: string, audience: string, requiredClaims: string[]): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.issuer,
        audience,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: this.config.clockToleranceSeconds,
        requiredClaims,
      });
      return payload;
    } catch (error) {
      throw new IdentityError(unavailable(error) ? 'UNAVAILABLE' : 'INVALID', { cause: error });
    }
  }
}

/** Clés injoignables : délai dépassé, réponse non 200 ou illisible, ou erreur réseau (hors erreurs `jose`). */
function unavailable(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true;
  if (error instanceof errors.JOSEError) return error.code === 'ERR_JOSE_GENERIC';
  return true;
}

function verified(payload: JWTPayload): VerifiedToken {
  if (typeof payload.sub !== 'string' || payload.sub === '' || typeof payload.iss !== 'string' || typeof payload.exp !== 'number') {
    throw new IdentityError('INVALID');
  }
  const operatorClaim = payload.operator_id;
  if (operatorClaim !== undefined && typeof operatorClaim !== 'string') throw new IdentityError('INVALID');
  return {
    issuer: payload.iss,
    subject: payload.sub,
    tokenId: typeof payload.jti === 'string' ? payload.jti : undefined,
    operatorClaim,
    expiresAt: new Date(payload.exp * 1000),
  };
}

/** Vérifieur de production : JWKS distante, mise en cache et rechargement limités par `jose`. */
export function createIdentityVerifier(config: OidcConfig): IdentityVerifier {
  const keys = createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 2000, cooldownDuration: 30000 });
  return new JoseIdentityVerifier(keys, config);
}
