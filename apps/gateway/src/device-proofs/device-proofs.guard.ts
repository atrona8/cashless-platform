// Garde des trois preuves d'un terminal sur la PASSERELLE (contracts/gateway-served-operations.md,
// « Preuves exigées » ; research R-19, R-21 ; interfaces.md § 10). Fichier à faire relire par une
// personne (cryptographie, authentification). Ordre, le premier échec arrête :
//   1. certificat client de la connexion : chaîne contre `GATEWAY_DEVICE_CA_FILE`, empreinte
//      égale à `edge_device.cert_sha256` (étape 4) ;
//   2. jeton d'appareil : `kid` PROPRE à la passerelle contrôlé avant toute cryptographie, ES256,
//      `aud = cashless-edge/<gateway_id>`, `exp` 900 s au plus (`DeviceTokenService.verify`), famille
//      de jetons `ACTIVE`, `cnf.jkt` = empreinte de `edge_device.public_key` ;
//   3. signature de requête RFC 9421 par `edge_device.public_key`, `@authority` ÉGALE à
//      `GATEWAY_REQUEST_AUTHORITY` (aucun joker, A20), `Content-Digest` sur les octets bruts,
//      `created` dans la tolérance mesurée sur `GatewayClock.now()` ;
//   puis statut du terminal relu dans la copie (`REVOKED` : 403 ; `SUSPENDED` : 403 sauf
//   `allowSuspended`), puis nonce à usage unique dans `edge_device_nonce`.
//
// Toute preuve échouée : `401` qui ne dit pas laquelle. Les étapes 1 à 4 répondent `UNAUTHENTICATED`
// (le terminal rafraîchit son jeton), la signature et le rejeu `DEVICE_SIGNATURE_INVALID`, comme
// le central. Le TEMPS de réponse d'un refus ne dépend pas de la preuve en cause : tout refus
// attend jusqu'à un plancher fixe (`failureFloorMs`), supérieur au coût d'une authentification
// réussie. Les comparaisons d'octets se font à temps constant (`timingSafeEqual`).
//
// Le garde ne décide JAMAIS de l'autorité de débit (c'est `AuthorityService`, WP17) : il l'ignore.
// Aucun journal ne contient un jeton, une signature, un certificat ou une clé.
import { createPublicKey, timingSafeEqual, type X509Certificate } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GatewayTx } from '../db/gateway-tx';
import { DeviceTokenService, p256Thumbprint } from '../device/device-token.service';
import { DeviceDirectory, type DeviceRecord } from './device-directory';
import { NonceStore } from './nonce-store';
import { loadDeviceCas, peerCertificate } from './peer-certificate';
import { ProblemException } from './problem';
import {
  authorityEquals,
  requestParts,
  SignatureProfileError,
  verifyContentDigest,
  verifyRequestSignature,
} from './request-signature';

export const DEVICE_PROOFS_KEY = 'gateway:device-proofs';
export const DEVICE_PROOFS_OPTIONS = Symbol('DEVICE_PROOFS_OPTIONS');
/** Plancher de durée d'un refus (ms), supérieur au coût d'une authentification réussie. */
export const DEFAULT_FAILURE_FLOOR_MS = 60;

export interface DeviceProofsMetadata {
  /** Terminal `SUSPENDED` admis (`getDeviceConfig`, `getDeviceSeqStatus`, heartbeat). */
  allowSuspended?: boolean;
  /**
   * `guard` (défaut, lectures) : le nonce est consommé ici, dans une transaction courte.
   * `operation` (écritures, lots 20 à 23) : la garde le laisse à l'opération, qui appelle
   * `NonceStore.consume(tx, ...)` dans SA transaction avec `req.device.proof`.
   */
  nonce?: 'guard' | 'operation';
}

export const DeviceProofs = (options: DeviceProofsMetadata = {}): MethodDecorator =>
  SetMetadata(DEVICE_PROOFS_KEY, options);

export interface DeviceProofsOptions {
  failureFloorMs?: number;
}

/** Ce que la garde pose sur la requête : le terminal tel que la copie le connaît. */
export interface AuthenticatedDevice {
  deviceId: string;
  serial: string;
  kind: string;
  appMode: string | null;
  posId: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  familyId: string;
  /** Nonce et date de la signature ; `consumed = false` en mode `operation`. */
  proof: { nonce: Buffer; created: Date; consumed: boolean };
}

export type DeviceRequest = Request & { device?: AuthenticatedDevice; rawBody?: unknown };

export function requestDevice(req: Request): AuthenticatedDevice {
  const device = (req as DeviceRequest).device;
  if (!device) throw new ProblemException('UNAUTHENTICATED');
  return device;
}

/** Refus interne : porte la raison (journal technique) et le problème rendu (sans la raison). */
class ProofFailure extends Error {
  constructor(
    readonly step: string,
    readonly reason: string,
    readonly problem: ProblemException,
  ) {
    super(reason);
  }
}

const unauthenticated = (step: string, reason: string): ProofFailure =>
  new ProofFailure(step, reason, new ProblemException('UNAUTHENTICATED'));
const badSignature = (step: string, reason: string): ProofFailure =>
  new ProofFailure(step, reason, new ProblemException('DEVICE_SIGNATURE_INVALID'));

const sameBytes = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Octets bruts du corps ; un corps reçu dont les octets n'ont pas été gardés est refusé. */
function rawBodyOf(req: DeviceRequest): Buffer {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  const length = Number(req.headers['content-length'] ?? '0');
  if (req.headers['transfer-encoding'] !== undefined || length !== 0)
    throw new SignatureProfileError('corps reçu sans ses octets bruts (rawBody)');
  return Buffer.alloc(0);
}

@Injectable()
export class DeviceProofsGuard implements CanActivate {
  private readonly logger = new Logger('DeviceProofs');
  private readonly floorMs: number;
  private cas: X509Certificate[] | null = null;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(DeviceTokenService) private readonly tokens: DeviceTokenService,
    @Inject(DeviceDirectory) private readonly directory: DeviceDirectory,
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Optional() @Inject(DEVICE_PROOFS_OPTIONS) options?: DeviceProofsOptions,
  ) {
    this.floorMs = options?.failureFloorMs ?? DEFAULT_FAILURE_FLOOR_MS;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const metadata =
      this.reflector.get<DeviceProofsMetadata | undefined>(
        DEVICE_PROOFS_KEY,
        context.getHandler(),
      ) ?? {};
    const started = process.hrtime.bigint();
    try {
      req.device = await this.authenticate(req, metadata);
      return true;
    } catch (error) {
      if (!(error instanceof ProofFailure)) throw error;
      this.logger.warn(
        JSON.stringify({
          event: 'device_authentication_refused',
          step: error.step,
          reason: error.reason,
          requestId: req.header('x-request-id'),
        }),
      );
      const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      if (elapsedMs < this.floorMs) await sleep(this.floorMs - elapsedMs);
      throw error.problem;
    }
  }

  private deviceCas(): X509Certificate[] {
    this.cas ??= loadDeviceCas(this.config.deviceCaFile);
    return this.cas;
  }

  private async authenticate(
    req: DeviceRequest,
    metadata: DeviceProofsMetadata,
  ): Promise<AuthenticatedDevice> {
    // 1. Certificat client de la connexion.
    const peer = peerCertificate(req, this.clock.now(), this.deviceCas());
    if ('refused' in peer) throw unauthenticated('1', peer.refused);

    // 2. Jeton d'appareil (kid propre, aud, exp), terminal et famille relus dans la copie.
    const bearer = BEARER.exec(req.header('authorization') ?? '');
    if (!bearer) throw unauthenticated('2', 'jeton absent ou mal formé');
    const found = await this.gatewayTx.run(async (tx) => {
      const claims = await this.tokens.verify(tx, bearer[1]!).catch((error: unknown) => {
        const reason = error instanceof Error && 'reason' in error ? String(error.reason) : 'jeton';
        throw unauthenticated('2', `jeton refusé (${reason})`);
      });
      const device = await this.directory.find(tx, claims.deviceId);
      const family = device ? await this.directory.family(tx, claims.familyId) : null;
      return { claims, device, family };
    });
    const { claims, device, family } = found;
    if (!device) throw unauthenticated('3', 'terminal inconnu de la copie locale');
    if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(device.status))
      throw unauthenticated('3', 'statut de terminal inconnu');
    if (!device.publicKey || !device.certSha256)
      throw unauthenticated('3', 'terminal sans clé ni certificat répliqués');
    // Famille : celle du jeton, rattachée à CE terminal, vivante. Un terminal révoqué apprend sa
    // révocation seulement après avoir prouvé qui il est (étapes 4 à 6).
    const revoked = device.status === 'REVOKED';
    if (!revoked && (!family || family.deviceId !== device.deviceId || family.status !== 'ACTIVE'))
      throw unauthenticated('3', 'famille de jetons absente ou révoquée');

    // 4. Certificat et jeton liés à CE terminal.
    if (!sameBytes(device.certSha256, peer.sha256))
      throw unauthenticated('4', 'certificat d’un autre terminal');
    let jkt: string;
    let publicKey: ReturnType<typeof createPublicKey>;
    try {
      publicKey = createPublicKey({ key: device.publicKey, format: 'der', type: 'spki' });
      jkt = await p256Thumbprint(device.publicKey);
    } catch {
      throw unauthenticated('4', 'clé de signature répliquée illisible');
    }
    if (!sameBytes(Buffer.from(jkt), Buffer.from(claims.jkt)))
      throw unauthenticated('4', 'jeton lié à une autre clé (cnf.jkt)');

    // 5-6. Parties couvertes, @authority exacte, corps, signature.
    let signed: { created: Date; nonce: Buffer };
    try {
      const parts = requestParts(req);
      if (!authorityEquals(parts.authority, this.config.requestAuthority))
        throw new SignatureProfileError('@authority différente de celle de la passerelle');
      verifyContentDigest(parts.contentDigest, rawBodyOf(req));
      signed = verifyRequestSignature(
        parts,
        { signatureInput: req.header('signature-input'), signature: req.header('signature') },
        device.deviceId,
        publicKey,
      );
    } catch (error) {
      if (!(error instanceof SignatureProfileError)) throw error;
      throw badSignature('5', error.reason);
    }

    // Statut relu dans la copie, après les trois preuves.
    if (revoked) throw new ProblemException('DEVICE_REVOKED');
    if (device.status === 'SUSPENDED' && metadata.allowSuspended !== true)
      throw new ProblemException('DEVICE_SUSPENDED');

    // Horloge de la requête, mesurée sur l'horloge de la passerelle (jamais l'heure système).
    return this.finish(device, claims.familyId, signed, metadata);
  }

  private async finish(
    device: DeviceRecord,
    familyId: string,
    signed: { created: Date; nonce: Buffer },
    metadata: DeviceProofsMetadata,
  ): Promise<AuthenticatedDevice> {
    let consumed = false;
    if (metadata.nonce !== 'operation') {
      const outcome = await this.nonces.consumeAlone(device.deviceId, signed.nonce, signed.created);
      if (outcome === 'CLOCK_SKEW')
        throw new ProblemException('CLOCK_SKEW_TOO_LARGE', {
          headers: { Date: this.clock.now().toUTCString() },
        });
      if (outcome === 'REPLAY') throw badSignature('7', 'nonce déjà vu');
      consumed = true;
    }
    return {
      deviceId: device.deviceId,
      serial: device.serial,
      kind: device.kind,
      appMode: device.appMode,
      posId: device.posId,
      status: device.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      familyId,
      proof: { nonce: signed.nonce, created: signed.created, consumed },
    };
  }
}
