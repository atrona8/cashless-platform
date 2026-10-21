// Jeton d'appareil (contracts/device-tokens.md, research R-07) : fabrication et vérification. Le jeton ne prouve que
// l'identité du terminal (`sub`), la clé à laquelle il est lié (`cnf.jkt`) et sa famille (`fid`) : `operator_id`,
// `serial` et `event_id` sont recopiés pour le contrat mais jamais crus — la garde relit le terminal en base à chaque
// requête, ainsi que la révocation de la famille.
import { createPublicKey, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/config';
import {
  DEVICE_TOKEN_ALG,
  DEVICE_TOKEN_TYP,
  TOKEN_SIGNER,
  type TokenSignerPort,
} from './token-signer.port';

export const DEVICE_TOKEN_AUDIENCE = 'cashless-device';

export interface DeviceTokenInput {
  deviceId: string;
  operatorId: string;
  serial: string;
  /** Événement d'affectation ; `null` pour un terminal sans affectation. */
  eventId: string | null;
  /** Clé publique de signature du terminal (SPKI DER, EC P-256) : `cnf.jkt` en est l'empreinte RFC 7638. */
  signingSpki: Buffer;
  familyId: string;
}

export interface IssuedDeviceToken {
  token: string;
  jti: string;
  /** Durée de validité en secondes (`expires_in`). */
  expiresIn: number;
  expiresAt: Date;
}

export interface DeviceTokenClaims {
  deviceId: string;
  /** Claim du contrat, jamais cru : relu en base par la garde. */
  operatorIdClaim: string;
  /** Claim du contrat, jamais cru : relu en base par la garde. */
  serialClaim: string;
  /** Claim du contrat, jamais cru : relu en base par la garde. */
  eventIdClaim: string | null;
  /** Empreinte RFC 7638 de la clé de signature du terminal, comparée à celle du terminal enregistré. */
  jkt: string;
  familyId: string;
  jti: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Jeton refusé, quelle qu'en soit la raison (la raison n'est jamais renvoyée au client). */
export class DeviceTokenError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Jeton d’appareil invalide', options);
    this.name = 'DeviceTokenError';
  }
}

/** Empreinte RFC 7638 (SHA-256) d'une clé publique EC P-256 donnée en SPKI DER ; toute autre clé est refusée. */
export async function p256Thumbprint(spki: Buffer): Promise<string> {
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('clé de signature EC P-256 attendue');
  const { kty, crv, x, y } = key.export({ format: 'jwk' });
  return calculateJwkThumbprint({ kty: kty!, crv: crv!, x: x!, y: y! }, 'sha256');
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

@Injectable()
export class DeviceTokenService {
  constructor(
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSignerPort,
    @Inject(APP_CONFIG)
    private readonly config: Pick<
      AppConfig,
      'deviceTokenIssuer' | 'deviceTokenTtlSeconds' | 'clockToleranceSeconds'
    >,
  ) {}

  async issue(input: DeviceTokenInput, now: Date = new Date()): Promise<IssuedDeviceToken> {
    const iat = Math.floor(now.getTime() / 1000);
    const expiresIn = this.config.deviceTokenTtlSeconds;
    const jti = randomBytes(16).toString('base64url');
    const claims: JWTPayload = {
      iss: this.config.deviceTokenIssuer,
      aud: DEVICE_TOKEN_AUDIENCE,
      sub: input.deviceId,
      operator_id: input.operatorId,
      serial: input.serial,
      event_id: input.eventId,
      cnf: { jkt: await p256Thumbprint(input.signingSpki) },
      fid: input.familyId,
      iat,
      exp: iat + expiresIn,
      jti,
    };
    return {
      token: await this.signer.sign(claims),
      jti,
      expiresIn,
      expiresAt: new Date((iat + expiresIn) * 1000),
    };
  }

  /** Claims d'un jeton valide, ou `DeviceTokenError` : ES256 seul, `kid` du signataire, `typ`, `iss`, `aud`, `exp`. */
  async verify(token: string): Promise<DeviceTokenClaims> {
    try {
      // Refus avant toute vérification cryptographique : un `kid` étranger n'est pas une clé de ce signataire.
      if (decodeProtectedHeader(token).kid !== this.signer.kid) throw new Error('kid inconnu');
      const key = await importJWK(this.signer.publicJwk(), DEVICE_TOKEN_ALG);
      const { payload } = await jwtVerify(token, key, {
        algorithms: [DEVICE_TOKEN_ALG],
        typ: DEVICE_TOKEN_TYP,
        issuer: this.config.deviceTokenIssuer,
        audience: DEVICE_TOKEN_AUDIENCE,
        clockTolerance: this.config.clockToleranceSeconds,
        requiredClaims: ['sub', 'iat', 'exp', 'jti', 'fid', 'cnf', 'operator_id', 'serial'],
      });
      const {
        sub,
        iat,
        exp,
        jti,
        fid,
        cnf,
        operator_id: operatorId,
        serial,
        event_id: eventId,
      } = payload;
      const jkt = (cnf as { jkt?: unknown } | null)?.jkt;
      if (
        !nonEmpty(sub) ||
        !nonEmpty(jti) ||
        !nonEmpty(fid) ||
        !nonEmpty(jkt) ||
        !nonEmpty(operatorId) ||
        !nonEmpty(serial) ||
        !(eventId === null || eventId === undefined || nonEmpty(eventId)) ||
        typeof iat !== 'number' ||
        typeof exp !== 'number'
      )
        throw new Error('claims mal formés');
      return {
        deviceId: sub,
        operatorIdClaim: operatorId,
        serialClaim: serial,
        eventIdClaim: eventId ?? null,
        jkt,
        familyId: fid,
        jti,
        issuedAt: new Date(iat * 1000),
        expiresAt: new Date(exp * 1000),
      };
    } catch (cause) {
      throw new DeviceTokenError({ cause });
    }
  }
}
