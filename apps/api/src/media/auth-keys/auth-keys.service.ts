// Mot de passe d'un bracelet pour un terminal (SPECIFICATION §7.4, §7.6 ; FR-018, NFR-003 ; contrat `getMediaAuthKey`),
// dans le SEUL processus qui peut déchiffrer une clé de données. Le bracelet est cherché par (prestataire du terminal,
// UID) ; son mot de passe stocké est rouvert avec la clé de données (un déchiffrement au plus, aucun si elle est dans
// le cache court), puis rechiffré pour la clé d'accord de CE terminal. Le clair n'existe qu'ici, le temps de la
// requête : tampon mis à zéro dans un `finally`.
// Bracelet inconnu, d'un autre prestataire, sans mot de passe stocké, d'une clé retirée ou d'un autre index : la même
// réponse `404 MEDIA_UNKNOWN`, après un délai constant et sans appel au service de clés — un terminal ne peut pas
// distinguer ces cas, ni par le corps ni par le temps.
import { Inject, Injectable } from '@nestjs/common';
import {
  deviceAad,
  openPwdPack,
  pwdPackAad,
  sealForRecipient,
  type EncryptedBlob,
} from '@cashless/tag-format';
import { TenantTx } from '../../db/tenant-tx';
import type { DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { DECRYPT_PORT, KmsUnavailableError, type DecryptPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { conflict } from '../../organization/platform/platform.dto';
import { DataKeyRepository } from '../keys/data-key.repository';
import { DekCache } from '../keys/dek-cache';

/** Durée minimale d'un refus « bracelet inconnu » : couvre le chemin nominal (lecture, cache, ouverture, enveloppe). */
export const UNKNOWN_MEDIA_DELAY_MS = 80;
/** Durée pendant laquelle le terminal peut garder le mot de passe en mémoire vive (contrat). */
export const AUTH_KEY_TTL_SECONDS = 60;

export interface MediaAuthKey {
  nfc_uid: string;
  key_index: number;
  enc: EncryptedBlob;
  ttl_seconds: number;
}

interface StoredSecret {
  id: string;
  pwd_pack_enc: Buffer | null;
  pwd_pack_dek_id: string | null;
  key_index: number;
  key_status: string;
  dek_status: string | null;
}

@Injectable()
export class AuthKeysService {
  constructor(
    private readonly tx: TenantTx,
    private readonly dataKeys: DataKeyRepository,
    private readonly cache: DekCache,
    @Inject(DECRYPT_PORT) private readonly kms: DecryptPort,
  ) {}

  async get(device: DeviceContext, uid: Buffer, keyIndex: number): Promise<MediaAuthKey> {
    const started = Date.now();
    if (!device.agreementPublicKey)
      throw conflict(
        'Ce terminal n’a pas de clé d’accord enregistrée : il ne peut pas recevoir de mot de passe.',
      );
    const recipient = device.agreementPublicKey;
    const { operatorId } = device;
    const media = await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<StoredSecret>(
        `SELECT m.id, m.pwd_pack_enc, m.pwd_pack_dek_id, m.key_index, k.status AS key_status, d.status AS dek_status
           FROM media m
           JOIN tag_key k ON k.operator_id = m.operator_id AND k.key_index = m.key_index
           LEFT JOIN tag_data_key d ON d.id = m.pwd_pack_dek_id
          WHERE m.operator_id = $1 AND m.nfc_uid = $2`,
        [operatorId, uid],
      );
      return rows[0] ?? null;
    });
    if (
      !media ||
      media.key_index !== keyIndex ||
      !media.pwd_pack_enc ||
      !media.pwd_pack_dek_id ||
      media.key_status === 'RETIRED' ||
      media.dek_status === 'RETIRED'
    ) {
      await sleepUntil(started + UNKNOWN_MEDIA_DELAY_MS);
      throw new ProblemException('MEDIA_UNKNOWN');
    }
    const dekId = media.pwd_pack_dek_id;
    const blob = media.pwd_pack_enc;
    let pwdPack: Buffer | undefined;
    try {
      pwdPack = await this.cache.withKey(
        dekId,
        async () => {
          const stored = await this.tx.run(operatorId, (client) =>
            this.dataKeys.encrypted(client, dekId),
          );
          if (!stored) throw new ProblemException('MEDIA_UNKNOWN');
          return this.kms.decrypt(stored.wrappingKeyRef, stored.encrypted);
        },
        (dek) =>
          openPwdPack({
            dek,
            blob,
            aad: pwdPackAad({ mediaId: media.id, operatorId, keyIndex, uid }),
          }),
      );
      // Statut du terminal relu juste avant la remise (mission 5a, lot WP12, décision du porteur
      // du 20/10/2026) : une révocation ou une suspension validée après la garde est vue ici, et
      // aucun mot de passe ne part (42501 -> 403 DEVICE_REVOKED, CL030 -> 403 DEVICE_SUSPENDED).
      // Aucune fonction ne prend le terminal FOR UPDATE dans cette transaction.
      await this.tx.run(operatorId, (client) =>
        client.query('SELECT assert_device_active($1)', [device.deviceId]),
      );
      return {
        nfc_uid: uid.toString('hex'),
        key_index: keyIndex,
        enc: sealForRecipient({
          recipientPublicKey: recipient,
          plaintext: pwdPack,
          aad: deviceAad(device.deviceId, uid),
        }),
        ttl_seconds: AUTH_KEY_TTL_SECONDS,
      };
    } catch (error) {
      if (error instanceof KmsUnavailableError) {
        throw new ProblemException('SERVICE_UNAVAILABLE', {
          status: 503,
          detail: 'Service de clés indisponible : réessayer.',
        });
      }
      throw error;
    } finally {
      if (pwdPack) zeroize(pwdPack);
    }
  }
}

function sleepUntil(time: number): Promise<void> {
  const wait = time - Date.now();
  return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
}
