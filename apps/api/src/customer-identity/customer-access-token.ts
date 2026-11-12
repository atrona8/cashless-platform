// Jeton d'accès du festivalier : JWT HS256 signé avec la sous-clé `accessToken` (customer-keys.ts), 900 s.
// `sub` = compte, `op` = prestataire, `dev` = famille du jeton de renouvellement (référence de l'appareil).
// La vérification impose l'algorithme, l'émetteur, l'audience et l'expiration ; la garde relit ensuite le compte en
// base (`CustomerDirectory`), si bien qu'un jeton ne fait jamais foi à lui seul.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { CustomerClaims } from './customer-identity.port';
import { deriveCustomerKey } from './customer-keys';

export const CUSTOMER_TOKEN_ISSUER = 'cashless-api';
export const CUSTOMER_TOKEN_AUDIENCE = 'cashless-customer';
export const CUSTOMER_TOKEN_TTL_SECONDS = 900;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CustomerAccessTokens {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'customerAuthHmacKey'>) {
    this.key = deriveCustomerKey(config.customerAuthHmacKey, 'accessToken');
  }

  async sign(claims: {
    customerId: string;
    operatorId: string;
    familyId: string;
  }): Promise<string> {
    return new SignJWT({ op: claims.operatorId, dev: claims.familyId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(CUSTOMER_TOKEN_ISSUER)
      .setAudience(CUSTOMER_TOKEN_AUDIENCE)
      .setSubject(claims.customerId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${CUSTOMER_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Les identités du jeton, ou `null` pour toute erreur (signature, algorithme, émetteur, audience, expiration…). */
  async verify(token: string): Promise<CustomerClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: CUSTOMER_TOKEN_ISSUER,
        audience: CUSTOMER_TOKEN_AUDIENCE,
        requiredClaims: ['exp', 'sub', 'jti'],
      });
      const { sub, op, dev } = payload as { sub?: unknown; op?: unknown; dev?: unknown };
      if (
        typeof sub !== 'string' ||
        typeof op !== 'string' ||
        typeof dev !== 'string' ||
        !UUID.test(sub) ||
        !UUID.test(op) ||
        !UUID.test(dev)
      )
        return null;
      return { customerId: sub.toLowerCase(), operatorId: op.toLowerCase(), deviceRef: dev };
    } catch {
      return null;
    }
  }
}
