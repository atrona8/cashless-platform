// `POST /v1/device-tokens/refresh` sur la PASSERELLE (refreshDeviceToken ; décision 11 du porteur ;
// écart accepté OP-N102 / ADR-157). Fichier à faire relire par une personne (jetons).
//
// RENOUVELLEMENT SANS ROTATION : la passerelle vérifie (1) le certificat du terminal contre
// l'autorité des terminaux, (2) la preuve de possession (signature du terminal sur le message à
// séparateur de domaine), (3) que SHA-256 du jeton de rafraîchissement présenté ÉGALE l'empreinte
// courante répliquée (`edge_device_token_family.refresh_token_sha256_current`), comparaison à temps
// constant. Elle émet UN jeton d'accès court (`aud = cashless-edge/<gateway_id>`, valable sur elle
// seule). Elle ne consomme pas, ne fait pas tourner, ne modifie pas l'empreinte courante, et ne
// génère AUCUN nouveau jeton de rafraîchissement. Le central force la rotation au retour de
// l'autorité (hors de ce lot, banc de WP25).
//
// Contradiction signalée : `TokenResponse` (openapi.yaml) exige `refresh_token`. La réponse reprend
// donc, à l'identique, le jeton PRÉSENTÉ par le terminal (rien de neuf n'est créé ni exposé : le
// terminal le détient déjà) ; ce n'est jamais une valeur différente (test).
//
// Refus : `401 REFRESH_TOKEN_INVALID` sans dire quelle preuve a échoué, après un plancher de durée
// fixe ; `403 DEVICE_SUSPENDED` / `DEVICE_REVOKED` seulement APRÈS preuve de possession.
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
  type X509Certificate,
} from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GatewayTx } from '../db/gateway-tx';
import { DeviceDirectory } from '../device-proofs/device-directory';
import {
  DEFAULT_FAILURE_FLOOR_MS,
  DEVICE_PROOFS_OPTIONS,
  type DeviceProofsOptions,
} from '../device-proofs/device-proofs.guard';
import { NonceStore } from '../device-proofs/nonce-store';
import { loadDeviceCas, peerCertificate } from '../device-proofs/peer-certificate';
import { ProblemException } from '../device-proofs/problem';
import { DeviceTokenService } from './device-token.service';
import { P1363_SIGNATURE_LENGTH, refreshProofMessage, type RefreshRequest } from './dto';

export interface RefreshResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  /** Le jeton présenté, à l'identique (voir l'en-tête : contradiction avec le contrat signalée). */
  refresh_token: string;
}

class Refused extends Error {
  constructor(
    readonly step: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

@Injectable()
export class DeviceRefreshService {
  private readonly logger = new Logger('DeviceRefresh');
  private readonly floorMs: number;
  private cas: X509Certificate[] | null = null;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(DeviceDirectory) private readonly directory: DeviceDirectory,
    @Inject(DeviceTokenService) private readonly tokens: DeviceTokenService,
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Optional() @Inject(DEVICE_PROOFS_OPTIONS) options?: DeviceProofsOptions,
  ) {
    this.floorMs = options?.failureFloorMs ?? DEFAULT_FAILURE_FLOOR_MS;
  }

  async refresh(req: Request, input: RefreshRequest): Promise<RefreshResponse> {
    const started = process.hrtime.bigint();
    try {
      return await this.exchange(req, input);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      this.logger.warn(
        JSON.stringify({
          event: 'device_token_refresh_refused',
          step: error.step,
          reason: error.reason,
          requestId: req.header('x-request-id'),
        }),
      );
      const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      if (elapsedMs < this.floorMs) await sleep(this.floorMs - elapsedMs);
      throw new ProblemException('REFRESH_TOKEN_INVALID');
    }
  }

  private async exchange(req: Request, input: RefreshRequest): Promise<RefreshResponse> {
    // 1. Certificat client de la connexion, chaîné à l'autorité des terminaux.
    this.cas ??= loadDeviceCas(this.config.deviceCaFile);
    const peer = peerCertificate(req, this.clock.now(), this.cas);
    if ('refused' in peer) throw new Refused(1, peer.refused);

    // 2. Terminal de ce `serial` qui porte CE certificat.
    const device = await this.gatewayTx.run((tx) => this.directory.findBySerial(tx, input.serial));
    if (
      !device?.publicKey ||
      !device.certSha256 ||
      device.certSha256.length !== peer.sha256.length ||
      !timingSafeEqual(device.certSha256, peer.sha256)
    )
      throw new Refused(2, 'aucun terminal de ce serial ne porte ce certificat');

    // 3. Preuve de possession.
    let proved = false;
    try {
      proved =
        input.signature.length === P1363_SIGNATURE_LENGTH &&
        verify(
          'sha256',
          refreshProofMessage(input.nonce, input.serial, input.refreshToken),
          {
            key: createPublicKey({ key: device.publicKey, format: 'der', type: 'spki' }),
            dsaEncoding: 'ieee-p1363',
          },
          input.signature,
        );
    } catch {
      proved = false;
    }
    if (!proved) throw new Refused(3, 'preuve de possession invalide');

    // 4. Statut, révélé seulement à celui qui a prouvé qui il est.
    if (device.status === 'REVOKED') throw new ProblemException('DEVICE_REVOKED');
    if (device.status === 'SUSPENDED') throw new ProblemException('DEVICE_SUSPENDED');
    if (device.status !== 'ACTIVE') throw new Refused(4, 'statut de terminal inconnu');

    // 5. Empreinte courante, à temps constant : TOUTES les familles vivantes sont comparées, sans
    // arrêt au premier succès.
    const presented = sha256(input.refreshToken);
    return this.gatewayTx.run(async (tx) => {
      const families = await this.directory.activeFamilies(tx, device.deviceId);
      let matched: string | null = null;
      for (const family of families) {
        const current = family.refreshTokenSha256Current;
        const equal =
          current !== null &&
          current.length === presented.length &&
          timingSafeEqual(current, presented);
        if (equal && matched === null) matched = family.fid;
      }
      if (matched === null) throw new Refused(5, 'empreinte différente de l’empreinte courante');
      // 6. Rejeu de la même demande signée : refusé (le nonce reste en table).
      const outcome = await this.nonces.consume(
        tx,
        device.deviceId,
        `refresh:${input.nonce}`,
        null,
      );
      if (outcome !== 'OK') throw new Refused(6, 'nonce déjà vu');
      const token = await this.tokens.issue(tx, {
        deviceId: device.deviceId,
        serial: device.serial,
        familyId: matched,
        signingSpki: device.publicKey!,
      });
      // Audit local : ni jeton, ni empreinte, ni clé.
      await tx.query(
        `INSERT INTO edge_audit (kind, actor, device_id, detail) VALUES ('DEVICE_TOKEN_ISSUED', 'gateway', $1, $2)`,
        [
          device.deviceId,
          JSON.stringify({
            fid: matched,
            kid: token.kid,
            jti: token.jti,
            exp: token.expiresAt.toISOString(),
          }),
        ],
      );
      return {
        access_token: token.token,
        token_type: 'Bearer' as const,
        expires_in: token.expiresIn,
        refresh_token: input.refreshToken,
      };
    });
  }
}
