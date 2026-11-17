// Mécanique commune des travailleurs de scellement (mission 9b, WP12 ; FR-020, NFR-005) : lecture des scellements par
// `ops_seals_since`, copie externe puis pose de la référence par `ops_record_seal_copy` (UNE fois). Aucune lecture de
// table : le rôle `cashless_maint` n'appelle que des fonctions `ops_*`.
import { Logger } from '@nestjs/common';
import type { TenantTx } from '../db/tenant-tx';
import { errorCode, type AlertItem } from '../processes/ops-alerts';
import type { SealExternalCopy, SealKind } from './seal-copy';

/** Intervalle de scellement, comme celui du délai de `seal_ledger` et `seal_audit` (5 minutes). */
export const SEAL_INTERVAL_MS = 300_000;
/** Fenêtre de rattrapage des copies manquantes (au-delà, la vérification quotidienne les signale). */
export const COPY_CATCH_UP_WINDOW = '1 day';

export interface SealRow {
  kind: SealKind;
  id: string;
  seal_no: number;
  seal_hash: Buffer;
  sealed_at: Date;
  external_ref: string | null;
}

export async function sealsSince(tx: TenantTx, window: string | null): Promise<SealRow[]> {
  return tx.withoutTenant(async (client) => {
    const { rows } = await client.query<SealRow>(
      'SELECT kind, id, seal_no, seal_hash, sealed_at, external_ref FROM ops_seals_since($1::interval)',
      [window],
    );
    return rows;
  });
}

/**
 * Copie chaque scellement sans référence externe de `kind`, puis pose la référence (une fois). Une copie qui échoue ne
 * bloque pas les suivantes ; elle est reprise au passage d'après. Rend le nombre de copies posées et les échecs (à
 * signaler par `OpsAlerts.sync`, qui ne les répète pas à chaque passage).
 */
export async function copyMissing(
  kind: SealKind,
  tx: TenantTx,
  copy: SealExternalCopy,
  worker: string,
  log: Logger,
): Promise<{ copied: number; failures: AlertItem[] }> {
  let copied = 0;
  const failures: AlertItem[] = [];
  const pending = (await sealsSince(tx, COPY_CATCH_UP_WINDOW)).filter(
    (seal) => seal.kind === kind && seal.external_ref === null,
  );
  for (const seal of pending) {
    try {
      const ref = await copy.write({ kind, id: seal.id, sealNo: seal.seal_no }, seal.seal_hash);
      await tx.withoutTenant(async (client) => {
        await client.query('SELECT ops_record_seal_copy($1, $2::uuid, $3::int, $4)', [
          kind,
          seal.id,
          seal.seal_no,
          ref,
        ]);
      });
      copied += 1;
    } catch (error) {
      log.warn(
        JSON.stringify({ event: 'seal.copy.failed', kind, id: seal.id, seal_no: seal.seal_no }),
      );
      failures.push({
        key: `copy:${kind}:${seal.id}:${seal.seal_no}`,
        detail: {
          worker,
          step: 'copy',
          kind,
          id: seal.id,
          seal_no: seal.seal_no,
          error: errorCode(error),
        },
      });
    }
  }
  return { copied, failures };
}
