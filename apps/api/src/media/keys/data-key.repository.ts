// Clés de données des bracelets (SPECIFICATION §7.4 ; research R-04, R-05, R-05 bis) : accès base partagé par la
// personnalisation (qui en OUVRE, sans jamais relire une clé chiffrée) et par le processus des clés de bracelet (qui
// en RELIT pour déchiffrer). Chaque méthode s'exécute dans la transaction — donc sous le rôle — de l'appelant.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';

export interface DataKeyVersion {
  id: string;
  version: number;
  status: 'ACTIVE' | 'DECRYPT_ONLY' | 'RETIRED';
}

@Injectable()
export class DataKeyRepository {
  /** Statut d'une clé de dérivation ; `null` si elle n'existe pas pour ce prestataire. */
  async keyStatus(client: TxClient, operatorId: string, keyIndex: number): Promise<'ACTIVE' | 'DECRYPT_ONLY' | 'RETIRED' | null> {
    const { rows } = await client.query<{ status: 'ACTIVE' | 'DECRYPT_ONLY' | 'RETIRED' }>(
      'SELECT status FROM tag_key WHERE operator_id = $1 AND key_index = $2',
      [operatorId, keyIndex],
    );
    return rows[0]?.status ?? null;
  }

  async isActive(client: TxClient, dekId: string): Promise<boolean> {
    const { rowCount } = await client.query("SELECT 1 FROM tag_data_key WHERE id = $1 AND status = 'ACTIVE'", [dekId]);
    return rowCount === 1;
  }

  /** Version ACTIVE d'un index, s'il y en a une. */
  async activeVersion(client: TxClient, operatorId: string, keyIndex: number): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>("SELECT id FROM tag_data_key WHERE operator_id = $1 AND key_index = $2 AND status = 'ACTIVE'", [operatorId, keyIndex]);
    return rows[0]?.id ?? null;
  }

  /**
   * Ouvre une nouvelle version ACTIVE ; toutes les autres versions non retirées de l'index ne servent plus qu'à
   * déchiffrer (l'index unique « une seule active » l'impose). Verrou consultatif : deux ouvertures simultanées sur
   * le même index se suivent au lieu de se heurter.
   */
  async openVersion(client: TxClient, operatorId: string, keyIndex: number, wrappingKeyRef: string, encrypted: Buffer): Promise<DataKeyVersion> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tag-data-key:' || $1::text || ':' || $2::text, 0))", [operatorId, keyIndex]);
    await client.query("UPDATE tag_data_key SET status = 'DECRYPT_ONLY' WHERE operator_id = $1 AND key_index = $2 AND status = 'ACTIVE'", [operatorId, keyIndex]);
    const { rows } = await client.query<DataKeyVersion>(
      `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek, status)
       VALUES ($1, $2, 1 + coalesce((SELECT max(version) FROM tag_data_key WHERE operator_id = $1 AND key_index = $2), 0), $3, $4, 'ACTIVE')
       RETURNING id, version, status`,
      [operatorId, keyIndex, wrappingKeyRef, encrypted],
    );
    return rows[0]!;
  }

  /** Clé de données chiffrée et sa clé d'emballage : lisible par le processus des clés de bracelet seulement. */
  async encrypted(client: TxClient, dekId: string): Promise<{ wrappingKeyRef: string; encrypted: Buffer; status: string } | null> {
    const { rows } = await client.query<{ wrapping_kms_key_ref: string; encrypted_dek: Buffer; status: string }>(
      'SELECT wrapping_kms_key_ref, encrypted_dek, status FROM tag_data_key WHERE id = $1',
      [dekId],
    );
    return rows[0] ? { wrappingKeyRef: rows[0].wrapping_kms_key_ref, encrypted: rows[0].encrypted_dek, status: rows[0].status } : null;
  }
}
