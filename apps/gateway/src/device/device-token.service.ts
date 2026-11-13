// Jetons d'appareil de la PASSERELLE (contracts/gateway-served-operations.md ; research R-19 ;
// décisions 2 et 11 du porteur). Fichier à faire relire par une personne (cryptographie, jetons).
//
// Décision 2 : la passerelle signe avec SA clé (`HARDWARE_KEYSTORE.sign('token', ...)`, la clé
// privée ne sort jamais du port, aucune méthode d'export), `kid = edge:<gateway_id>:<n>`,
// `aud = cashless-edge/<gateway_id>`. Le central refuse un tel jeton (autre `kid`, autre audience,
// autre signataire : test) ; la passerelle refuse un jeton du central (autre `kid`) AVANT toute
// cryptographie, comme le central (device-token.service.ts:118), et le terminal rafraîchit.
//
// Rotation de la clé : le port garde UNE clé de jeton ; quand sa clé publique change, la ligne
// `edge_token_key` active passe `RETIRED` (`rotated_at`) et `n + 1` devient active. Une clé retirée
// ne vérifie QUE les jetons émis avant la rotation et jamais au-delà de `rotated_at + 900 s` :
// l'ancien jeton reste valable jusqu'à son `exp`, jamais après, et une clé retirée ne permet pas
// de forger un jeton neuf.
//
// ÉCARTS ACCEPTÉS, bornés par les tests de ce lot (jamais élargis en silence) :
//  - OP-N101 / ADR-156 : les jetons de la passerelle sont valables sur elle seule ;
//  - OP-N102 / ADR-157 : renouvellement SANS rotation du jeton de rafraîchissement sur la
//    passerelle (`refresh.service.ts`), rotation forcée par le central au retour.
// Aucun journal ne contient un jeton, une empreinte de jeton de rafraîchissement ou une clé.
import { createPublicKey, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { HARDWARE_KEYSTORE, type HardwareKeystore } from '../key-store/hardware-keystore.port';

export const DEVICE_TOKEN_ALG = 'ES256';
export const DEVICE_TOKEN_TYP = 'device+jwt';
/** Durée de vie maximale d'un jeton d'accès émis ou accepté par la passerelle (secondes). */
export const DEVICE_TOKEN_TTL_SECONDS = 900;
/** Tolérance sur `iat` seulement (recalage de l'horloge par une mesure centrale) ; `exp` : aucune. */
const IAT_FUTURE_TOLERANCE_SECONDS = 60;
const KEY_LOCK = 'edge_token_key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const edgeAudience = (gatewayId: string): string => `cashless-edge/${gatewayId}`;

export interface IssuedDeviceToken {
  token: string;
  jti: string;
  expiresIn: number;
  expiresAt: Date;
  kid: string;
}

export interface DeviceTokenClaims {
  deviceId: string;
  familyId: string;
  /** Empreinte RFC 7638 de la clé de signature du terminal. */
  jkt: string;
  jti: string;
  kid: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Jeton refusé, quelle qu'en soit la raison (jamais renvoyée au client). */
export class DeviceTokenError extends Error {
  constructor(readonly reason: string) {
    super('Jeton d’appareil invalide');
    this.name = 'DeviceTokenError';
  }
}

/** Empreinte RFC 7638 (SHA-256) d'une clé publique EC P-256 en SPKI DER ; toute autre clé est refusée. */
export async function p256Thumbprint(spki: Buffer): Promise<string> {
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('clé de signature EC P-256 attendue');
  const { kty, crv, x, y } = key.export({ format: 'jwk' });
  return calculateJwkThumbprint({ kty: kty!, crv: crv!, x: x!, y: y! }, 'sha256');
}

const b64u = (value: string | Buffer): string => Buffer.from(value).toString('base64url');
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

interface KeyRow {
  kid: string;
  public_jwk: { kty: string; crv: string; x: string; y: string };
  status: 'ACTIVE' | 'RETIRED';
  rotated_at: Date | null;
}

interface MetaRow {
  gateway_id: string;
  operator_id: string;
  event_id: string;
}

@Injectable()
export class DeviceTokenService {
  private meta: MetaRow | null = null;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(HARDWARE_KEYSTORE) private readonly keystore: HardwareKeystore,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  /** Identité de la passerelle (jamais modifiée après l'enrôlement : lue une fois). */
  async identity(tx: TxClient): Promise<MetaRow> {
    if (this.meta) return this.meta;
    const { rows } = await tx.query<MetaRow>(
      'SELECT gateway_id, operator_id, event_id FROM edge_meta',
    );
    if (!rows[0]) throw new Error('edge_meta absent : passerelle non enrôlée');
    this.meta = rows[0];
    return rows[0];
  }

  /**
   * Aligne `edge_token_key` sur la clé publique que le port présente : première clé -> `n = 1` ;
   * clé publique changée -> l'active est retirée, `n + 1` devient active. Rend le `kid` actif.
   */
  async syncKey(tx: TxClient): Promise<string> {
    const { gateway_id: gatewayId } = await this.identity(tx);
    const spki = await this.keystore.publicKey('token');
    const { kty, crv, x, y } = createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({
      format: 'jwk',
    });
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [KEY_LOCK]);
    const { rows } = await tx.query<KeyRow & { n: string }>(
      `SELECT kid, public_jwk, status, rotated_at, split_part(kid, ':', 3) AS n
         FROM edge_token_key ORDER BY split_part(kid, ':', 3)::int DESC`,
    );
    const active = rows.find((row) => row.status === 'ACTIVE');
    if (active && active.public_jwk.x === x && active.public_jwk.y === y) return active.kid;
    const next = rows.length === 0 ? 1 : Number(rows[0]!.n) + 1;
    const now = this.clock.now();
    if (active) {
      await tx.query(
        `UPDATE edge_token_key SET status = 'RETIRED', rotated_at = $2 WHERE kid = $1`,
        [active.kid, now],
      );
    }
    const kid = `edge:${gatewayId}:${next}`;
    await tx.query(
      `INSERT INTO edge_token_key (kid, public_jwk, status, created_at) VALUES ($1, $2, 'ACTIVE', $3)`,
      [kid, JSON.stringify({ kty, crv, x, y }), now],
    );
    return kid;
  }

  /** Émet un jeton d'accès court pour le terminal (dans la transaction de l'appelant). */
  async issue(
    tx: TxClient,
    input: { deviceId: string; serial: string; familyId: string; signingSpki: Buffer },
  ): Promise<IssuedDeviceToken> {
    const meta = await this.identity(tx);
    const kid = await this.syncKey(tx);
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const jti = randomBytes(16).toString('base64url');
    const claims = {
      iss: meta.gateway_id,
      aud: edgeAudience(meta.gateway_id),
      sub: input.deviceId,
      operator_id: meta.operator_id,
      serial: input.serial,
      event_id: meta.event_id,
      cnf: { jkt: await p256Thumbprint(input.signingSpki) },
      fid: input.familyId,
      iat,
      exp: iat + DEVICE_TOKEN_TTL_SECONDS,
      jti,
    };
    const signingInput = `${b64u(JSON.stringify({ alg: DEVICE_TOKEN_ALG, typ: DEVICE_TOKEN_TYP, kid }))}.${b64u(JSON.stringify(claims))}`;
    const signature = await this.keystore.sign('token', Buffer.from(signingInput, 'utf8'));
    if (signature.length !== 64) throw new Error('signature ES256 brute de 64 octets attendue');
    return {
      token: `${signingInput}.${b64u(signature)}`,
      jti,
      kid,
      expiresIn: DEVICE_TOKEN_TTL_SECONDS,
      expiresAt: new Date((iat + DEVICE_TOKEN_TTL_SECONDS) * 1000),
    };
  }

  /**
   * Claims d'un jeton valide, ou `DeviceTokenError` : `kid` PROPRE à cette passerelle (contrôlé
   * avant toute cryptographie), ES256 seul, `typ`, `iss`, `aud`, `exp` (900 s au plus), clé retirée
   * bornée par la rotation.
   */
  async verify(tx: TxClient, token: string): Promise<DeviceTokenClaims> {
    const { gateway_id: gatewayId } = await this.identity(tx);
    let kid: string;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== DEVICE_TOKEN_ALG || header.typ !== DEVICE_TOKEN_TYP)
        throw new DeviceTokenError('en-tête');
      kid = String(header.kid ?? '');
    } catch (error) {
      throw error instanceof DeviceTokenError ? error : new DeviceTokenError('en-tête illisible');
    }
    // Refus AVANT toute cryptographie : un `kid` du central (ou de toute autre passerelle) n'est
    // pas une clé de cette passerelle.
    if (!new RegExp(`^edge:${gatewayId}:[1-9][0-9]{0,8}$`).test(kid))
      throw new DeviceTokenError('kid étranger');
    const { rows } = await tx.query<KeyRow>(
      'SELECT kid, public_jwk, status, rotated_at FROM edge_token_key WHERE kid = $1',
      [kid],
    );
    const key = rows[0];
    if (!key) throw new DeviceTokenError('kid inconnu');
    const now = this.clock.now();
    try {
      const imported = await importJWK(key.public_jwk, DEVICE_TOKEN_ALG);
      const { payload } = await jwtVerify(token, imported, {
        algorithms: [DEVICE_TOKEN_ALG],
        typ: DEVICE_TOKEN_TYP,
        issuer: gatewayId,
        audience: edgeAudience(gatewayId),
        currentDate: now,
        clockTolerance: 0,
        requiredClaims: ['sub', 'iat', 'exp', 'jti', 'fid', 'cnf', 'operator_id', 'serial'],
      });
      const { sub, iat, exp, jti, fid, cnf } = payload;
      const jkt = (cnf as { jkt?: unknown } | null)?.jkt;
      if (
        !nonEmpty(sub) ||
        !nonEmpty(jti) ||
        !nonEmpty(fid) ||
        !nonEmpty(jkt) ||
        typeof iat !== 'number' ||
        typeof exp !== 'number' ||
        !UUID.test(sub) ||
        !UUID.test(fid)
      )
        throw new DeviceTokenError('claims mal formés');
      if (exp - iat > DEVICE_TOKEN_TTL_SECONDS || exp <= iat)
        throw new DeviceTokenError('durée de vie hors borne');
      if (iat * 1000 > now.getTime() + IAT_FUTURE_TOLERANCE_SECONDS * 1000)
        throw new DeviceTokenError('émis dans le futur');
      if (key.status === 'RETIRED') {
        const rotated = key.rotated_at?.getTime();
        if (
          rotated === undefined ||
          (iat + 1) * 1000 > rotated ||
          now.getTime() > rotated + DEVICE_TOKEN_TTL_SECONDS * 1000
        )
          throw new DeviceTokenError('clé retirée');
      }
      return {
        deviceId: sub.toLowerCase(),
        familyId: fid.toLowerCase(),
        jkt,
        jti,
        kid,
        issuedAt: new Date(iat * 1000),
        expiresAt: new Date(exp * 1000),
      };
    } catch (error) {
      throw error instanceof DeviceTokenError ? error : new DeviceTokenError('vérification');
    }
  }
}
