// `getMediaAuthKey` sur la passerelle (WP23, T106 ; gateway-served-operations.md ligne 5, note 3).
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, mots de passe de bracelets, canari NFR-010).
//
// Le colis `pwd_pack_enc` du bracelet est ouvert avec la clé de contenu du flux, elle-même ouverte EN
// MÉMOIRE par `HARDWARE_KEYSTORE.agree` (la clé d'accord privée ne sort pas), puis RESCELLÉ pour la
// clé d'accord du terminal (ECDH-ES P-256, HKDF-SHA256, AES-256-GCM, AAD `deviceAad`). Le mot de passe
// n'est jamais persisté, journalisé, ni placé dans une exception : tampons mis à zéro dans `finally`.
// Aucune clé maître (C-009). Toute réponse « bracelet inconnu » (inconnu, autre index, pas de colis, pas de
// clé de contenu détenue, clé d'accord détruite, colis illisible) est UNE SEULE réponse `404 MEDIA_UNKNOWN`
// rendue après le MÊME délai plancher qu'un succès : le terminal ne distingue ni par le corps ni par le temps.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx } from '../../db/gateway-tx';
import type { AuthenticatedDevice } from '../../device-proofs/device-proofs.guard';
import { ProblemException } from '../../device-proofs/problem';
import { AUTHORITY, type AuthorityService } from '../../authority/authority.service';
import { PackCryptoError, openMediaPack, resealForDevice, wipe } from './pack-crypto';
import { PackKeyReader } from './pack-key-reader';

export const MEDIA_AUTH_OPTIONS = Symbol('MEDIA_AUTH_OPTIONS');
export interface MediaAuthOptions {
  /** Durée plancher de toute réponse (succès ou bracelet inconnu), en ms. */
  floorMs: number;
  /** Demandes admises par terminal et par minute (compteur local, mémoire du processus). */
  perMinute: number;
}
export const DEFAULT_MEDIA_AUTH_OPTIONS: MediaAuthOptions = { floorMs: 80, perMinute: 60 };
/** Durée pendant laquelle le terminal garde le mot de passe en mémoire vive (contrat). */
export const AUTH_KEY_TTL_SECONDS = 60;

const NFC_UID = /^[0-9a-f]{14}$/;

export interface MediaAuthKeyBody {
  nfc_uid: string;
  key_index: number;
  enc: unknown;
  ttl_seconds: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class MediaAuthKeyService {
  private readonly hits = new Map<string, number[]>();
  private readonly options: MediaAuthOptions;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(PackKeyReader) private readonly packKey: PackKeyReader,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AUTHORITY) private readonly authority: Pick<AuthorityService, 'state'>,
    @Optional() @Inject(MEDIA_AUTH_OPTIONS) options?: MediaAuthOptions,
  ) {
    this.options = options ?? DEFAULT_MEDIA_AUTH_OPTIONS;
  }

  /** `429` : au-delà de `perMinute` demandes par terminal sur 60 s glissantes (échecs compris). */
  private throttle(deviceId: string): void {
    const now = this.clock.now().getTime();
    const recent = (this.hits.get(deviceId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.options.perMinute) {
      this.hits.set(deviceId, recent);
      throw new ProblemException('RATE_LIMITED', { headers: { 'Retry-After': '60' } });
    }
    recent.push(now);
    this.hits.set(deviceId, recent);
  }

  private parse(body: unknown): { uid: Buffer; keyIndex: number } {
    const o = typeof body === 'object' && body !== null && !Array.isArray(body) ? body : null;
    const { nfc_uid: uid, key_index: keyIndex } = (o ?? {}) as Record<string, unknown>;
    if (
      typeof uid !== 'string' ||
      !NFC_UID.test(uid) ||
      typeof keyIndex !== 'number' ||
      !Number.isInteger(keyIndex) ||
      keyIndex < 0 ||
      keyIndex > 65535
    )
      throw new ProblemException('VALIDATION_FAILED', { status: 400 });
    return { uid: Buffer.from(uid, 'hex'), keyIndex };
  }

  async get(device: AuthenticatedDevice, body: unknown): Promise<MediaAuthKeyBody> {
    const { uid, keyIndex } = this.parse(body);
    this.throttle(device.deviceId);
    const started = performance.now();
    try {
      const result = await this.compute(device, uid, keyIndex);
      await this.waitFloor(started);
      return result;
    } catch (error) {
      await this.waitFloor(started);
      if (error instanceof ProblemException) throw error;
      // Toute autre défaillance (colis, clé détruite, base) : la même réponse, sans détail.
      throw new ProblemException('MEDIA_UNKNOWN');
    }
  }

  private async waitFloor(started: number): Promise<void> {
    const remaining = this.options.floorMs - (performance.now() - started);
    if (remaining > 0) await sleep(remaining);
  }

  private async compute(
    device: AuthenticatedDevice,
    uid: Buffer,
    keyIndex: number,
  ): Promise<MediaAuthKeyBody> {
    if ((await this.authority.state()).state === 'REVOKED')
      throw new ProblemException('CONFLICT_STATE', { detail: 'GATEWAY_NOT_AUTHORITY' });
    let contentKey: Buffer | null = null;
    let pwdPack: Buffer | undefined;
    try {
      const found = await this.gatewayTx.run(async (tx) => {
        const dev = await tx.query<{ agreement_public_key: Buffer | null }>(
          'SELECT agreement_public_key FROM edge_device WHERE device_id = $1',
          [device.deviceId],
        );
        const agreement = dev.rows[0]?.agreement_public_key ?? null;
        if (agreement === null || agreement.length !== 65)
          throw new ProblemException('CONFLICT_STATE', {
            detail: 'Ce terminal n’a pas de clé d’accord enregistrée.',
          });
        const media = await tx.query<{
          media_id: string;
          pwd_pack_enc: Buffer;
          operator_id: string;
        }>(
          `SELECT m.media_id, m.pwd_pack_enc, e.operator_id
             FROM edge_media m CROSS JOIN edge_meta e
            WHERE m.uid = $1 AND m.key_index = $2 AND m.media_id IS NOT NULL
              AND m.pwd_pack_enc IS NOT NULL
            ORDER BY m.token_hash LIMIT 1`,
          [uid, keyIndex],
        );
        const row = media.rows[0];
        if (!row) return null;
        const key = await this.packKey.open(tx);
        return key === null ? null : { agreement, row, key };
      });
      if (found === null) throw new ProblemException('MEDIA_UNKNOWN');
      contentKey = found.key;
      try {
        pwdPack = openMediaPack({
          contentKey,
          stored: found.row.pwd_pack_enc,
          mediaId: found.row.media_id,
          operatorId: found.row.operator_id,
          keyIndex,
          uid,
        });
      } catch (error) {
        throw error instanceof PackCryptoError ? new ProblemException('MEDIA_UNKNOWN') : error;
      }
      const enc = resealForDevice({
        pwdPack,
        deviceAgreementKey: found.agreement,
        deviceId: device.deviceId,
        uid,
      });
      return {
        nfc_uid: uid.toString('hex'),
        key_index: keyIndex,
        enc,
        ttl_seconds: AUTH_KEY_TTL_SECONDS,
      };
    } finally {
      wipe(contentKey, pwdPack);
    }
  }
}
