// Rafraîchissement des jetons d'appareil (contracts/device-tokens.md ; research R-07 ; FR-010,
// FR-011, NFR-008 ; OP-N65, ADR-108 ; ADR-115). Lot WP15.
//
// Ordre des contrôles (le premier échec arrête ; un 401 ne dit jamais quelle preuve a échoué, la
// raison exacte va au journal technique, sans jeton, ni signature, ni certificat) :
//   1. certificat client de la connexion (`peerCertificate`, même lecture que la garde des
//      terminaux) : autorité des terminaux, validité, empreinte SHA-256 ;
//   2. terminal relu sous le prestataire `O=` du certificat (aiguillage seulement, jamais cru) par
//      son `serial` ET l'empreinte du certificat présenté : un autre certificat ne désigne aucun
//      terminal de ce `serial` ;
//   3. preuve de possession : signature ECDSA (`ieee-p1363`) du message à séparateur de domaine
//      (refresh.dto.ts) par `device.public_key` ;
//   4. terminal `REVOKED` (ADR-115) : `403 DEVICE_REVOKED` si le jeton présenté est le sien et
//      était vivant à la révocation (révoqué pour DEVICE_REVOKED seulement, jamais consommé, non
//      expiré), sinon 401 ; dans les deux cas, lecture seule : ni nonce, ni rotation ;
//   5. nonce consommé (`consume_device_nonce`, heure de la base, transaction propre, comme l'étape
//      7 de la garde) : rejeu refusé ; aucune écriture avant cette étape ;
//   6. `rotate_device_refresh_token`, seul dans sa transaction (READ COMMITTED, niveau par défaut
//      jamais élevé ici) : ROTATED / GRACE → nouvelle paire, jeton d'appareil de la même famille
//      signé AVANT la validation (un échec de signature annule l'échange) ; IN_PROGRESS → 409
//      (à réessayer) ; REUSED → audit `DEVICE_TOKEN_REUSE` dans la transaction qui valide la
//      révocation de la famille, puis 401 une fois validée ; INVALID → 401 ; SUSPENDED → 403
//      DEVICE_SUSPENDED ; REVOKED (révocation validée entre l'étape 2 et l'échange) → 403.
//
// Nonce : le corps du contrat ne porte pas d'heure de création ; le nonce est consommé avec l'heure
// de la base (`now()`), il reste donc en table au moins 2 × tolérance + 300 s (purge), bien plus
// que la grâce de 60 s. Au-delà, le jeton de rafraîchissement est à usage unique : une requête
// rejouée tombe sur un jeton consommé (réutilisation, famille révoquée), jamais sur un nouveau.
import { createPublicKey, verify } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { peerCertificate } from '../../device-identity/real-device-identity';
import {
  DeviceTokenService,
  type IssuedDeviceToken,
} from '../../device-tokens/device-token.service';
import { ProblemException } from '../../errors/problem';
import { requestIdOf } from '../../http/request-id.middleware';
import { newRefreshToken, refreshTokenHash } from '../enrollment/refresh-token';
import { P1363_SIGNATURE_LENGTH, refreshProofMessage, type RefreshRequest } from './refresh.dto';

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Réponse du contrat (TokenResponse). */
export interface RefreshResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

type Outcome = 'ROTATED' | 'GRACE' | 'IN_PROGRESS' | 'INVALID' | 'REUSED' | 'SUSPENDED' | 'REVOKED';

interface RefreshDevice {
  id: string;
  operator_id: string;
  event_id: string | null;
  serial: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  public_key: Buffer | null;
}

/** Étape du refus (journal seulement). */
type Step = 1 | 2 | 3 | 4 | 5 | 6;

const refused = () => new ProblemException('REFRESH_TOKEN_INVALID');

/** Prestataire annoncé par le sujet du certificat (`O=`), émis par l'autorité des terminaux. */
function subjectOperator(subject: string): string | null {
  const values = subject
    .split('\n')
    .filter((line) => line.startsWith('O='))
    .map((line) => line.slice(2));
  return values.length === 1 && UUID.test(values[0]!) ? values[0]!.toLowerCase() : null;
}

@Injectable()
export class DeviceTokenRefreshService {
  private readonly logger = new Logger('DeviceTokenRefresh');

  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly tokens: DeviceTokenService,
    @Inject(APP_CONFIG)
    private readonly config: Pick<AppConfig, 'deviceRefreshTokenTtlDays' | 'clockToleranceSeconds'>,
  ) {}

  async refresh(req: Request, input: RefreshRequest): Promise<RefreshResponse> {
    // 1. Certificat client.
    const peer = peerCertificate(req, new Date());
    if ('refused' in peer) throw this.refuse(req, 1, peer.refused);
    const operatorId = subjectOperator(peer.certificate.subject);
    if (!operatorId) throw this.refuse(req, 1, 'certificat sans prestataire lisible (O=)');

    // 2. Terminal de ce `serial` qui porte CE certificat, sous le prestataire annoncé.
    const device = await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<RefreshDevice>(
        `SELECT id, operator_id, event_id, serial, status, public_key
           FROM device WHERE operator_id = $1 AND serial = $2 AND cert_sha256 = $3 LIMIT 2`,
        [operatorId, input.serial, peer.sha256],
      );
      return rows.length === 1 ? rows[0]! : null;
    });
    if (!device?.public_key)
      throw this.refuse(req, 2, 'aucun terminal de ce serial ne porte ce certificat');

    // 3. Preuve de possession.
    let proved = false;
    try {
      proved =
        input.signature.length === P1363_SIGNATURE_LENGTH &&
        verify(
          'sha256',
          refreshProofMessage(input.nonce, input.serial, input.refreshToken),
          {
            key: createPublicKey({ key: device.public_key, format: 'der', type: 'spki' }),
            dsaEncoding: 'ieee-p1363',
          },
          input.signature,
        );
    } catch {
      proved = false;
    }
    if (!proved) throw this.refuse(req, 3, 'preuve de possession invalide', device.id);

    const tokenHash = refreshTokenHash(input.refreshToken);
    // 4. Terminal révoqué : lecture seule (ADR-115).
    if (device.status === 'REVOKED') {
      if (await this.revokedDeviceToken(device, tokenHash, peer.sha256))
        throw new ProblemException('DEVICE_REVOKED');
      throw this.refuse(
        req,
        4,
        'terminal révoqué, jeton qui n’était pas le sien et vivant',
        device.id,
      );
    }

    // 5. Nonce (rejeu), heure de la base.
    const nonce = await this.tx.run(device.operator_id, async (client) => {
      const { rows } = await client.query<{ outcome: 'OK' | 'CLOCK_SKEW' | 'REPLAY' }>(
        'SELECT consume_device_nonce($1, $2, now(), $3) AS outcome',
        [device.id, Buffer.from(input.nonce, 'utf8'), this.config.clockToleranceSeconds],
      );
      return rows[0]!.outcome;
    });
    if (nonce !== 'OK') throw this.refuse(req, 5, `nonce refusé (${nonce})`, device.id);

    // 6. Échange.
    return this.rotate(req, device, tokenHash, peer.sha256);
  }

  /**
   * Jeton présenté par un terminal révoqué (ADR-115) : le sien, vivant au moment de la révocation
   * (révoqué avec le terminal, jamais consommé, non expiré), avec le certificat du terminal.
   */
  private revokedDeviceToken(
    device: RefreshDevice,
    tokenHash: Buffer,
    certSha256: Buffer,
  ): Promise<boolean> {
    return this.tx.run(device.operator_id, async (client) => {
      const { rows } = await client.query<{ found: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM device_refresh_token t JOIN device d ON d.id = t.device_id
            WHERE t.token_hash = $1 AND t.device_id = $2 AND t.operator_id = $3
              AND d.status = 'REVOKED' AND d.cert_sha256 = $4
              AND t.revoked_reason = 'DEVICE_REVOKED' AND t.consumed_at IS NULL
              AND t.expires_at > now()) AS found`,
        [tokenHash, device.id, device.operator_id, certSha256],
      );
      return rows[0]!.found;
    });
  }

  private async rotate(
    req: Request,
    device: RefreshDevice,
    tokenHash: Buffer,
    certSha256: Buffer,
  ): Promise<RefreshResponse> {
    const next = newRefreshToken();
    const result = await this.tx.run<{
      outcome: Outcome;
      token?: IssuedDeviceToken;
    }>(device.operator_id, async (client) => {
      const { rows } = await client.query<{
        outcome: Outcome;
        device_id: string | null;
        family_id: string | null;
      }>('SELECT outcome, device_id, family_id FROM rotate_device_refresh_token($1, $2, $3, $4)', [
        tokenHash,
        certSha256,
        refreshTokenHash(next),
        new Date(Date.now() + this.config.deviceRefreshTokenTtlDays * DAY_MS),
      ]);
      const row = rows[0]!;
      if (row.outcome === 'REUSED') await this.recordReuse(client, req, device, row);
      if (row.outcome !== 'ROTATED' && row.outcome !== 'GRACE') return { outcome: row.outcome };
      // Le certificat a désigné ce terminal, et l'échange a vérifié que c'est celui du jeton : un
      // autre terminal ici serait une incohérence, l'échange est annulé.
      if (row.device_id !== device.id || !row.family_id)
        throw new Error('Rafraîchissement : jeton échangé pour un autre terminal');
      const token = await this.tokens.issue({
        deviceId: device.id,
        operatorId: device.operator_id,
        serial: device.serial,
        eventId: device.event_id,
        signingSpki: device.public_key!,
        familyId: row.family_id,
      });
      return { outcome: row.outcome, token };
    });
    if (result.token)
      return {
        access_token: result.token.token,
        token_type: 'Bearer',
        expires_in: result.token.expiresIn,
        refresh_token: next,
      };
    switch (result.outcome) {
      case 'IN_PROGRESS':
        throw new ProblemException('CONFLICT_STATE', {
          status: 409,
          detail: 'Échange déjà en cours pour ce jeton de rafraîchissement ; réessayer.',
          extensions: { retryable: true },
        });
      case 'SUSPENDED':
        throw new ProblemException('DEVICE_SUSPENDED');
      case 'REVOKED':
        throw new ProblemException('DEVICE_REVOKED');
      default:
        // REUSED (famille révoquée et audit validés) ou INVALID.
        throw this.refuse(req, 6, `échange refusé (${result.outcome})`, device.id);
    }
  }

  /**
   * Audit de la réutilisation, dans la transaction qui révoque la famille : validés ensemble, avant
   * le refus 401 (aucune révocation sans sa ligne, aucune ligne annulée avec le refus). Ni jeton,
   * ni empreinte : le terminal du jeton, sa famille, le terminal qui l'a présenté.
   */
  private async recordReuse(
    client: TxClient,
    req: Request,
    presenter: RefreshDevice,
    row: { device_id: string | null; family_id: string | null },
  ): Promise<void> {
    await this.audit.record(client, {
      operatorId: presenter.operator_id,
      actorId: null,
      actorRole: null,
      origin: `device:${presenter.id}`,
      requestId: requestIdOf(req) || null,
      action: 'DEVICE_TOKEN_REUSE',
      objectType: 'device',
      objectId: row.device_id ?? undefined,
      after: {
        family_id: row.family_id,
        revoked_reason: 'REUSE',
        presented_by_device_id: presenter.id,
        same_device: row.device_id === presenter.id,
      },
    });
  }

  private refuse(req: Request, step: Step, reason: string, deviceId?: string): ProblemException {
    this.logger.warn(
      JSON.stringify({
        event: 'device_token_refresh_refused',
        requestId: requestIdOf(req),
        step,
        reason,
        ...(deviceId ? { deviceId } : {}),
      }),
    );
    return refused();
  }
}
