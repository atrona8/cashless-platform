// Livraison des colis de mots de passe à la passerelle du banc (NFR-010, NFR-013) : des bracelets
// personnalisés sont semés au central, le travailleur `tag-keys` dépose clé de contenu et colis
// scellés pour la clé d'accord de la passerelle, la passerelle les reçoit par le flux de
// réplication. Le délai de garde des colis (30 minutes en exploitation) est franchi en vieillissant
// l'inscription de la passerelle du banc.
import { EdgePacksService } from '../../../api/src/edge/packs/edge-packs.service';
import { createKeyProcess } from '../../../api/test/support/app';
import { withOwner } from '../../../api/test/support/db';
import { seedPersonalizedMedia, type SeededMedia } from '../../../api/test/support/media-fixtures';
import { until, type TwoProcessBench } from './two-process-bench';

export async function seedFreshMedia(
  bench: TwoProcessBench,
  count: number,
): Promise<SeededMedia[]> {
  const w = bench.world;
  return withOwner((db) =>
    seedPersonalizedMedia(db, {
      operatorId: bench.operatorId,
      batchId: w.batchId,
      kmsKeyRef: w.w.keyRef.a,
      count,
    }),
  );
}

/**
 * Dépose clé de contenu et colis au central pour la passerelle du banc, avant ou après son
 * démarrage (migration 0071 : le dépôt entre dans le flux ; `pack-after-start.spec.ts`).
 */
export async function depositPacks(bench: TwoProcessBench): Promise<number> {
  await bench.centralQuery(
    `UPDATE edge_gateway SET registered_at = now() - interval '2 hours',
            role_changed_at = now() - interval '2 hours' WHERE id = $1`,
    [bench.gatewayId],
  );
  const keys = await createKeyProcess('tag-keys');
  try {
    return await keys.app.get(EdgePacksService, { strict: false }).runOnce([bench.operatorId]);
  } finally {
    await keys.app.close();
  }
}

/** Attend que la passerelle détienne le colis scellé de chacun des bracelets `mediaIds`. */
export async function awaitLocalPacks(bench: TwoProcessBench, mediaIds: string[]): Promise<void> {
  await until(
    'colis des bracelets reçus par la passerelle',
    async () => {
      const rows = await bench.localQuery<{ n: string }>(
        'SELECT count(*)::text AS n FROM edge_media WHERE media_id = ANY($1::uuid[]) ' +
          'AND pwd_pack_enc IS NOT NULL',
        [mediaIds],
      );
      return Number(rows[0]!.n) === mediaIds.length;
    },
    120_000,
    500,
  );
}
