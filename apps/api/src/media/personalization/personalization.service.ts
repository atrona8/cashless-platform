// Enregistrement d'un bracelet personnalisé (SPECIFICATION §7.3 à §7.5 ; FR-016, FR-017, NFR-002, NFR-003 ; décisions
// du porteur n° 4 et n° 7), dans le SEUL processus qui peut faire calculer un mot de passe de bracelet.
//   1. le service de clés calcule `PWD‖PACK` (GenerateMac sur la clé du lot, message SP 800-108) ;
//   2. il est scellé sous la clé de données de session (ce processus n'a pas le droit de déchiffrer) et enregistré avec
//      le bracelet, dans une seule transaction (`register_personalized_media`) ;
//   3. il est rendu au poste sous enveloppe pour sa clé publique à usage unique.
// Le mot de passe n'existe en clair qu'ici, en mémoire, le temps de la requête : tampon mis à zéro dans un `finally`.
// Il n'entre ni dans une réponse en clair, ni dans un journal, ni dans l'audit, ni dans le registre d'idempotence
// (qui ne garde que l'identifiant du bracelet : un rejeu recalcule l'enveloppe pour la clé présentée).
import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  derivationMessage,
  pwdPackAad,
  sealForRecipient,
  sealPwdPack,
  splitPwdPack,
  stationAad,
  type EncryptedBlob,
} from '@cashless/tag-format';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import { ClaimHasher } from '../../kms/claim-hash';
import { KmsUnavailableError, MAC_PORT, type MacPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { conflict, notFound, unprocessable } from '../../organization/platform/platform.dto';
import { DataKeyRepository } from '../keys/data-key.repository';
import { SessionDataKeyProvider } from '../keys/session-data-key';
import { personalizationHash, type PersonalizationInput } from './personalization.dto';

/** Portée des clés d'idempotence du poste de personnalisation. */
export const PERSONALIZATION_SCOPE = 'perso:';
/** Conservation d'une clé d'idempotence : celle du contrat (30 jours, ADR-79). */
const IDEMPOTENCY_TTL = '30 days';
const IDEMPOTENCY_CONSTRAINT = 'api_idempotency_uniq';

export interface PersonalizedMedia {
  media_id: string;
  key_index: number;
  pwd_pack: EncryptedBlob;
}

interface Target {
  keyIndex: number;
  kmsKeyRef: string;
}

@Injectable()
export class PersonalizationService {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly sessions: SessionDataKeyProvider,
    private readonly dataKeys: DataKeyRepository,
    private readonly hasher: ClaimHasher,
    @Inject(MAC_PORT) private readonly kms: MacPort,
  ) {}

  async register(
    operatorId: string,
    input: PersonalizationInput,
    idempotencyKey: string,
    actor: AuditContext,
  ): Promise<PersonalizedMedia> {
    const hash = personalizationHash(input);
    // Deux envois simultanés de la même clé : le second attend le premier, puis rejoue.
    for (let attempt = 1; ; attempt += 1) {
      const prepared = await this.tx.run(operatorId, (client) =>
        this.prepare(client, operatorId, input, idempotencyKey, hash),
      );
      const mediaId = prepared.existingMediaId ?? randomUUID();
      const pwdPack = await this.derive(prepared.target, operatorId, input.uid);
      try {
        if (!prepared.existingMediaId) {
          try {
            await this.store(
              operatorId,
              prepared.target,
              mediaId,
              pwdPack,
              input,
              idempotencyKey,
              hash,
              actor,
            );
          } catch (error) {
            if (isSqlError(error) && error.code === '23505') {
              if (error.constraint === IDEMPOTENCY_CONSTRAINT && attempt === 1) continue;
              throw conflict('Cette puce est déjà enregistrée (UID ou identité déjà connus).');
            }
            throw error;
          }
        }
        return {
          media_id: mediaId,
          key_index: prepared.target.keyIndex,
          pwd_pack: sealForRecipient({
            recipientPublicKey: input.stationPublicKey,
            plaintext: pwdPack,
            aad: stationAad(mediaId, input.uid),
          }),
        };
      } finally {
        zeroize(pwdPack);
      }
    }
  }

  /** Lot, clé et rejeu éventuel ; les refus qui ne demandent aucun calcul de clé partent d'ici. */
  private async prepare(
    client: TxClient,
    operatorId: string,
    input: PersonalizationInput,
    idempotencyKey: string,
    hash: string,
  ) {
    const batch = await client.query<{ key_index: number; status: string }>(
      'SELECT key_index, status FROM media_batch WHERE id = $1',
      [input.batchId],
    );
    if (!batch.rows[0]) throw notFound();
    const key = await client.query<{ kms_key_ref: string; status: string }>(
      'SELECT kms_key_ref, status FROM tag_key WHERE operator_id = $1 AND key_index = $2',
      [operatorId, batch.rows[0].key_index],
    );
    if (!key.rows[0]) throw notFound();
    const target: Target = {
      keyIndex: batch.rows[0].key_index,
      kmsKeyRef: key.rows[0].kms_key_ref,
    };
    const known = await client.query<{
      request_hash: string;
      response_body: { media_id?: unknown } | null;
    }>(
      'SELECT request_hash, response_body FROM api_idempotency WHERE operator_id = $1 AND scope = $2 AND idempotency_key = $3',
      [operatorId, PERSONALIZATION_SCOPE, idempotencyKey],
    );
    if (known.rows[0]) {
      if (known.rows[0].request_hash !== hash) throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
      const mediaId = known.rows[0].response_body?.media_id;
      const media = await client.query(
        'SELECT 1 FROM media WHERE id = $1 AND nfc_uid = $2 AND batch_id = $3',
        [mediaId, input.uid, input.batchId],
      );
      if (typeof mediaId !== 'string' || media.rowCount !== 1)
        throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
      return { target, existingMediaId: mediaId };
    }
    if (!input.signatureOk)
      throw unprocessable('Signature d’originalité invalide : la puce est refusée.');
    if (batch.rows[0].status !== 'ORDERED' && batch.rows[0].status !== 'PERSONALIZED') {
      throw conflict(
        `Le lot n’est plus en préparation (${batch.rows[0].status}) : il n’accepte plus de bracelet.`,
      );
    }
    if (key.rows[0].status !== 'ACTIVE')
      throw conflict('La clé de ce lot n’est pas active : elle ne personnalise plus de bracelet.');
    return { target, existingMediaId: null };
  }

  /** `PWD‖PACK` de la puce, calculé par le service de clés. L'appelant met le tampon à zéro. */
  private async derive(target: Target, operatorId: string, uid: Buffer): Promise<Buffer> {
    const mac = await unavailable(() =>
      this.kms.generateMac(
        target.kmsKeyRef,
        derivationMessage({ operatorId, keyIndex: target.keyIndex, uid }),
      ),
    );
    try {
      return splitPwdPack(mac).pwdPack;
    } finally {
      zeroize(mac);
    }
  }

  /**
   * Scelle le mot de passe sous la clé de données de session et enregistre le bracelet. Si la version de session a
   * cessé d'être active entre-temps (autre instance, rotation), une nouvelle est ouverte et l'essai refait UNE fois.
   */
  private async store(
    operatorId: string,
    target: Target,
    mediaId: string,
    pwdPack: Buffer,
    input: PersonalizationInput,
    idempotencyKey: string,
    hash: string,
    actor: AuditContext,
  ): Promise<void> {
    const aad = pwdPackAad({ mediaId, operatorId, keyIndex: target.keyIndex, uid: input.uid });
    for (let attempt = 1; ; attempt += 1) {
      const stored = await unavailable(() =>
        this.sessions.withKey(operatorId, target.keyIndex, async (key) => {
          const sealed = sealPwdPack({ dek: key.dek, nonce: randomBytes(12), pwdPack, aad });
          try {
            await this.tx.run(operatorId, async (client) => {
              await client.query(
                `INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, response_status, response_body, response_headers,
                                              completed_at, expires_at)
                 VALUES ($1, $2, $3, $4, 'COMPLETED', 201, $5::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp() + $6::interval)`,
                [
                  operatorId,
                  PERSONALIZATION_SCOPE,
                  idempotencyKey,
                  hash,
                  JSON.stringify({ media_id: mediaId }),
                  IDEMPOTENCY_TTL,
                ],
              );
              await client.query(
                'SELECT register_personalized_media($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [
                  input.batchId,
                  mediaId,
                  input.tokenHash,
                  input.uid,
                  input.signatureSha256,
                  input.signatureOk,
                  sealed,
                  key.dekId,
                  actor.actorId,
                ],
              );
              await this.audit.record(client, {
                ...actor,
                operatorId,
                action: 'MEDIA_PERSONALIZED',
                objectType: 'media',
                objectId: mediaId,
                after: {
                  batch_id: input.batchId,
                  key_index: target.keyIndex,
                  data_key_version: key.version,
                },
              });
            });
            return true;
          } catch (error) {
            // Refus d'état : est-ce la clé de session qui n'est plus la version active ?
            if (
              isSqlError(error) &&
              error.code === 'CL020' &&
              !(await this.tx.run(operatorId, (client) =>
                this.dataKeys.isActive(client, key.dekId),
              ))
            )
              return false;
            throw error;
          }
        }),
      );
      if (stored) return;
      if (attempt >= 2)
        throw conflict('La clé de données de ce lot change en ce moment : réessayer.');
    }
  }

  /**
   * Associe le code imprimé scanné par le poste. Un code inconnu, d'un autre lot, invalidé ou déjà associé reçoit le
   * même refus (422) : le motif va à l'audit, jamais le code. Rend `true` si l'association existait déjà (rejeu).
   */
  async associateClaimCode(
    operatorId: string,
    mediaId: string,
    code: string,
    actor: AuditContext,
  ): Promise<boolean> {
    let hash: Buffer | null;
    try {
      hash = this.hasher.claimCodeHash(code);
    } catch {
      hash = null;
    }
    const outcome = await this.tx.run(operatorId, async (client) => {
      const media = await client.query<{
        batch_id: string | null;
        claim_code_hash: Buffer | null;
        kind: string | null;
      }>(
        `SELECT m.batch_id, m.claim_code_hash, b.kind FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1`,
        [mediaId],
      );
      const row = media.rows[0];
      if (!row) throw notFound();
      if (row.kind !== 'PUBLIC')
        throw conflict('Ce bracelet appartient à un lot sans code de rattachement.');
      if (row.claim_code_hash !== null) {
        if (hash && row.claim_code_hash.equals(hash)) return 'REPLAYED' as const;
        throw conflict('Ce bracelet porte déjà un code de rattachement.');
      }
      let reason = hash ? await this.refusal(client, hash, row.batch_id) : 'BAD_CLAIM_CODE';
      if (!reason && hash) reason = await this.associate(client, hash, mediaId, row.batch_id);
      await this.audit.record(client, {
        ...actor,
        operatorId,
        action: reason ? 'CLAIM_CODE_ASSOCIATION_REFUSED' : 'CLAIM_CODE_ASSOCIATED',
        objectType: 'media',
        objectId: mediaId,
        after: reason ? { reason } : { batch_id: row.batch_id },
      });
      return reason ? ('REFUSED' as const) : ('ASSOCIATED' as const);
    });
    if (outcome === 'REFUSED') throw unprocessable('Code de rattachement refusé.');
    return outcome === 'REPLAYED';
  }

  /**
   * Motif du refus, lu sans verrou : ce processus n'a aucun droit d'écriture sur `claim_code` (migration 0019, lot 20,
   * cycle 7). `associate_claim_code` verrouille et refait ces contrôles ; une écriture concurrente qui les devance est
   * tranchée par elle (voir `associate`).
   */
  private async refusal(
    client: TxClient,
    hash: Buffer,
    batchId: string | null,
  ): Promise<string | null> {
    const { rows } = await client.query<{
      batch_id: string;
      media_id: string | null;
      invalidated_at: Date | null;
    }>('SELECT batch_id, media_id, invalidated_at FROM claim_code WHERE code_hash = $1', [hash]);
    const code = rows[0];
    if (!code) return 'CLAIM_CODE_UNKNOWN';
    if (code.invalidated_at !== null) return 'CLAIM_CODE_INVALIDATED';
    if (code.media_id !== null) return 'CLAIM_CODE_ALREADY_ASSOCIATED';
    if (code.batch_id !== batchId) return 'CLAIM_CODE_OTHER_BATCH';
    return null;
  }

  /**
   * Associe par la fonction, seul chemin d'écriture (SECURITY DEFINER, migration 0019). Rend `null` si le code est
   * associé ; si une écriture concurrente a devancé les contrôles de `refusal`, la base refuse et le motif est relu
   * après coup (lot 20, cycle 8) : en READ COMMITTED, la nouvelle lecture voit l'écriture validée qui a tranché (une
   * invalidation à la clôture, une autre association). Motif par défaut si la relecture ne l'explique pas : déjà associé.
   */
  private async associate(
    client: TxClient,
    hash: Buffer,
    mediaId: string,
    batchId: string | null,
  ): Promise<string | null> {
    await client.query('SAVEPOINT claim_code_association');
    try {
      await client.query('SELECT associate_claim_code($1, $2)', [hash, mediaId]);
      await client.query('RELEASE SAVEPOINT claim_code_association');
      return null;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT claim_code_association');
      if (isSqlError(error) && (error.code === 'CL020' || error.code === '23505')) {
        return (await this.refusal(client, hash, batchId)) ?? 'CLAIM_CODE_ALREADY_ASSOCIATED';
      }
      throw error;
    }
  }
}

/** Service de clés injoignable : refus temporaire (503), rien n'est enregistré. */
async function unavailable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof KmsUnavailableError) {
      throw new ProblemException('SERVICE_UNAVAILABLE', {
        status: 503,
        detail: 'Service de clés indisponible : rien n’a été enregistré, réessayer.',
      });
    }
    throw error;
  }
}
