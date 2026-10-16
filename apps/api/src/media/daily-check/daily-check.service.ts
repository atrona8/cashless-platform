// Contrôle quotidien des mots de passe stockés (SPECIFICATION §7.4 ; FR-010, NFR-003 ;
// contracts/key-services.md). Processus `tag-check`, rôle de base `cashless_tagcheck`, droits du
// service de clés : calculer un mot de passe et ouvrir une clé de données. Par prestataire, au
// plus une fois par 24 h : un échantillon d'au plus 100 bracelets personnalisés est recalculé
// (`generateMac`) et comparé, en temps constant, au mot de passe stocké (déchiffré par sa clé de
// données, une seule fois par clé). Tous les tampons en clair sont mis à zéro. Écart : compte
// rendu `MISMATCH` et une ligne d'audit par bracelet (son identifiant seulement). Aucune
// anomalie : la liste des sortes est fermée (§12.2) et aucune ne correspond (choix du porteur du
// 13/10/2026, consigné dans la spec). Panne du service de clés ou erreur inattendue : `ERROR`,
// nouvel essai 15 minutes plus tard au plus tôt ; le processus le signale par son code de sortie.
import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { derivationMessage, openPwdPack, pwdPackAad, splitPwdPack } from '@cashless/tag-format';
import { AuditService } from '../../audit/audit.service';
import { TenantTx } from '../../db/tenant-tx';
import {
  DECRYPT_PORT,
  KmsKeyError,
  KmsUnavailableError,
  MAC_PORT,
  type DecryptPort,
  type MacPort,
} from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';

export const SAMPLE_SIZE = 100;
/** Délai avant de réessayer un prestataire dont le dernier passage a échoué (panne du service de clés). */
const ERROR_BACKOFF = "interval '15 minutes'";

export interface CheckOutcome {
  status: 'OK' | 'MISMATCH' | 'ERROR';
  sampled: number;
  mismatches: string[];
}

/** Cause d'un passage interrompu : panne du service de clés, ou erreur inattendue (nom seulement). */
interface Failure {
  kind: 'kms' | 'unexpected';
  name: string;
}

interface SampleRow {
  id: string;
  nfc_uid: Buffer;
  key_index: number;
  pwd_pack_enc: Buffer;
  dek_id: string;
  kms_key_ref: string;
  wrapping_kms_key_ref: string;
  encrypted_dek: Buffer;
  dek_status: string;
}

@Injectable()
export class DailyCheckService {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    @Inject(MAC_PORT) private readonly mac: MacPort,
    @Inject(DECRYPT_PORT) private readonly decrypt: DecryptPort,
  ) {}

  /** Prestataires qui ont au moins une clé de bracelet (politique nominative du rôle). */
  async operators(): Promise<string[]> {
    return this.tx.unscoped(async (client) => {
      const { rows } = await client.query<{ operator_id: string }>(
        'SELECT DISTINCT operator_id FROM tag_key ORDER BY operator_id',
      );
      return rows.map((r) => r.operator_id);
    });
  }

  /**
   * Faut-il contrôler ce prestataire maintenant ? Non s'il a eu un passage OK ou en écart dans les
   * 24 dernières heures, ni une panne dans les 15 dernières minutes (pas de relance en boucle qui
   * chargerait le service de clés et remplirait la table des comptes rendus).
   */
  async due(operatorId: string): Promise<boolean> {
    return this.tx.run(operatorId, async (client) => {
      const { rowCount } = await client.query(
        `SELECT 1 FROM tag_key_check_run
          WHERE (status <> 'ERROR' AND started_at > clock_timestamp() - interval '24 hours')
             OR (status = 'ERROR' AND started_at > clock_timestamp() - ${ERROR_BACKOFF})
          LIMIT 1`,
      );
      return (rowCount ?? 0) === 0;
    });
  }

  /**
   * Un passage pour un prestataire : échantillon, recalcul, comparaison, compte rendu. Une erreur
   * propre à un bracelet ou à une clé (format, chiffré illisible, clé de données retirée encore
   * référencée, clé de bracelet désactivée ou inconnue du service de clés) est un écart pour ce
   * bracelet. L'indisponibilité du service de clés interrompt le passage (ERROR). Toute autre
   * erreur l'interrompt aussi, mais est inscrite (ERROR, avec le nom de l'erreur seulement) : le
   * prestataire a son compte rendu, l'ordonnanceur est alerté, et les prestataires suivants sont
   * contrôlés au lieu d'être bloqués derrière celui-ci.
   */
  async runOnce(operatorId: string): Promise<CheckOutcome> {
    const sample = await this.sample(operatorId);
    const mismatches: string[] = [];
    const deks = new Map<string, Buffer | null>(); // null : clé de données illisible
    let checked = 0;
    let failure: Failure | null = null;
    try {
      for (const media of sample) {
        if (!(await this.checkOne(operatorId, media, deks))) mismatches.push(media.id);
        checked += 1;
      }
    } catch (error) {
      // Le nom seulement : un message d'erreur pourrait porter une donnée du bracelet.
      failure =
        error instanceof KmsUnavailableError
          ? { kind: 'kms', name: error.name }
          : { kind: 'unexpected', name: error instanceof Error ? error.name : typeof error };
    } finally {
      for (const dek of deks.values()) zeroize(dek);
    }
    // Un écart déjà trouvé l'emporte sur une panne survenue ensuite : il doit être signalé.
    const status = mismatches.length > 0 ? 'MISMATCH' : failure ? 'ERROR' : 'OK';
    await this.record(operatorId, { status, sampled: checked, mismatches }, failure, sample.length);
    return { status, sampled: checked, mismatches };
  }

  /** Vrai si le mot de passe stocké du bracelet est bien celui que le service de clés recalcule. */
  private async checkOne(
    operatorId: string,
    media: SampleRow,
    deks: Map<string, Buffer | null>,
  ): Promise<boolean> {
    // Une version retirée n'est plus référencée par aucun bracelet (contracts/key-services.md) :
    // un bracelet qui la référence encore est une anomalie (rechiffrement manqué).
    if (media.dek_status === 'RETIRED') return false;
    if (!deks.has(media.dek_id)) deks.set(media.dek_id, await this.openDek(media));
    const dek = deks.get(media.dek_id);
    if (!dek) return false;
    let message: Buffer;
    try {
      message = derivationMessage({ operatorId, keyIndex: media.key_index, uid: media.nfc_uid });
    } catch {
      return false; // UID ou index de clé hors format : donnée du bracelet altérée
    }
    let mac: Buffer;
    try {
      mac = await this.mac.generateMac(media.kms_key_ref, message);
    } catch (error) {
      // Clé de bracelet désactivée, inconnue ou d'un autre type alors que `tag_key` la dit en
      // service : c'est précisément ce qu'un contrôle d'intégrité doit signaler.
      if (error instanceof KmsKeyError) return false;
      throw error;
    }
    return this.matches(operatorId, media, dek, mac);
  }

  /** Clé de données en clair ; `null` si le service de clés la refuse (chiffré ou référence altérés). */
  private async openDek(media: SampleRow): Promise<Buffer | null> {
    try {
      return await this.decrypt.decrypt(media.wrapping_kms_key_ref, media.encrypted_dek);
    } catch (error) {
      if (error instanceof KmsUnavailableError) throw error;
      return null;
    }
  }

  /**
   *  Mot de passe stocké (déchiffré) = mot de passe recalculé ; un chiffré altéré ne s'ouvre
   *  pas : écart.
   */
  private matches(operatorId: string, media: SampleRow, dek: Buffer, mac: Buffer): boolean {
    const expected = splitPwdPack(mac).pwdPack;
    let stored: Buffer | null = null;
    try {
      const aad = pwdPackAad({
        mediaId: media.id,
        operatorId,
        keyIndex: media.key_index,
        uid: media.nfc_uid,
      });
      stored = openPwdPack({ dek, blob: media.pwd_pack_enc, aad });
      return stored.length === expected.length && timingSafeEqual(stored, expected);
    } catch {
      return false;
    } finally {
      zeroize(mac, expected, stored);
    }
  }

  /**
   * Tirage aléatoire en base ; bracelets retirés ou détruits, et clés de bracelet retirées,
   * écartés. Les clés de données retirées restent : un bracelet qui en référence une est un écart.
   */
  private async sample(operatorId: string): Promise<SampleRow[]> {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<SampleRow>(
        `SELECT m.id, m.nfc_uid, m.key_index, m.pwd_pack_enc, m.pwd_pack_dek_id AS dek_id,
                tk.kms_key_ref, dk.wrapping_kms_key_ref, dk.encrypted_dek, dk.status AS dek_status
           FROM media m
           JOIN tag_key tk ON tk.operator_id = m.operator_id AND tk.key_index = m.key_index
           JOIN tag_data_key dk ON dk.id = m.pwd_pack_dek_id
          WHERE m.kind = 'NFC_TAG' AND m.personalized_at IS NOT NULL AND m.pwd_pack_enc IS NOT NULL
            AND m.nfc_uid IS NOT NULL AND m.status NOT IN ('RETIRED', 'DESTROYED')
            AND tk.status <> 'RETIRED'
          ORDER BY random() LIMIT $1`,
        [SAMPLE_SIZE],
      );
      return rows;
    });
  }

  private async record(
    operatorId: string,
    outcome: CheckOutcome,
    failure: Failure | null,
    planned: number,
  ) {
    const cause = !failure
      ? ''
      : failure.kind === 'kms'
        ? `service de clés ${failure.name}`
        : `erreur inattendue ${failure.name}`;
    const interrupted = failure
      ? ` Passage interrompu après ${outcome.sampled} sur ${planned} : ${cause}.`
      : '';
    const detail =
      outcome.status === 'ERROR'
        ? failure?.kind === 'kms'
          ? `Service de clés : ${failure.name} ; nouvel essai dans 15 minutes au plus tôt.`
          : `Erreur inattendue : ${failure?.name} ; nouvel essai dans 15 minutes au plus tôt.`
        : outcome.status === 'MISMATCH'
          ? `${outcome.mismatches.length} écart(s) ; bracelets nommés au journal d'audit.${interrupted}`
          : null;
    await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status, detail)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [operatorId, outcome.sampled, outcome.mismatches.length, outcome.status, detail],
      );
      for (const mediaId of outcome.mismatches) {
        await this.audit.record(client, {
          actorId: null,
          actorRole: null,
          origin: 'tag-check',
          requestId: null,
          operatorId,
          action: 'MEDIA_PASSWORD_MISMATCH',
          objectType: 'media',
          objectId: mediaId,
          after: { check_run_id: rows[0]!.id },
        });
      }
    });
  }
}
