// Accès base du travailleur d'enveloppes (WP12) : UNIQUEMENT les fonctions accordées à
// `cashless_snapcontent` (`offline_snapshot_keys_to_wrap`, `wrap_offline_snapshot_key`,
// `offline_snapshot_targets`). Aucune écriture directe, aucune lecture de table.
import { Injectable } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import type { WrappedKey } from '@cashless/tag-format';

export interface KeyToWrap {
  ledgerId: string;
  version: bigint;
  deviceId: string;
  agreementPublicKey: Buffer;
  agreementKeySha256: Buffer;
  contentKeyWrapped: Buffer;
}

/** Refus normal de la base (terminal plus éligible, clé d'accord changée, version périmée). */
const REFUSED = new Set(['CL001', 'P0002']);

@Injectable()
export class DeviceWrappingRepository {
  constructor(private readonly tx: TenantTx) {}

  async toWrap(limit: number): Promise<KeyToWrap[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{
        ledger_id: string;
        version: bigint | string;
        device_id: string;
        agreement_public_key: Buffer;
        agreement_key_sha256: Buffer;
        content_key_wrapped: Buffer;
      }>(
        'SELECT ledger_id, version, device_id, agreement_public_key, agreement_key_sha256, ' +
          'content_key_wrapped FROM offline_snapshot_keys_to_wrap($1)',
        [limit],
      );
      return rows.map((row) => ({
        ledgerId: row.ledger_id,
        version: BigInt(row.version),
        deviceId: row.device_id,
        agreementPublicKey: row.agreement_public_key,
        agreementKeySha256: row.agreement_key_sha256,
        contentKeyWrapped: row.content_key_wrapped,
      }));
    });
  }

  /** Prestataire de chaque grand livre ciblé (un terminal éligible implique un ciblage). */
  async operators(): Promise<Map<string, string>> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ ledger_id: string; operator_id: string }>(
        'SELECT ledger_id, operator_id FROM offline_snapshot_targets()',
      );
      return new Map(rows.map((row) => [row.ledger_id, row.operator_id]));
    });
  }

  /** Écrit l'enveloppe ; faux si la base la refuse (le prochain passage relit la file). */
  async store(operatorId: string, item: KeyToWrap, envelope: WrappedKey): Promise<boolean> {
    try {
      await this.tx.run(operatorId, (client) =>
        client.query('SELECT wrap_offline_snapshot_key($1, $2, $3, $4, $5::jsonb)', [
          item.ledgerId,
          item.version,
          item.deviceId,
          item.agreementKeySha256,
          JSON.stringify(envelope),
        ]),
      );
      return true;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && REFUSED.has(code)) return false;
      throw error;
    }
  }
}
