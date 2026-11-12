// Versement des ordres locaux à deux personnes au central (décision 33 du porteur, ADR-169).
//
// Les lignes `edge_audit` `SITE_ORDER_ACCEPTED` (écrites par `consumeOrderNonce`, pour
// `LOCAL_UNSTALE`
// et `PURGE`) partent dans `EdgeSyncBatch.local_orders` (champ facultatif, au plus 50 lignes),
// couvertes par la signature du lot. `sent_in_batch` n'est posé qu'à la réception des résultats du
// lot ; la liste exacte vient du corps conservé (`edge_outgoing_batch.body`), jamais d'une
// relecture.
// Une ligne mal formée n'est PAS versée (le central refuserait le lot) : alerte
// `LOCAL_ORDER_UNSENDABLE`, la ligne locale reste. Aucune signature ni clé ne part : seulement le
// type, les deux noms, l'heure et l'empreinte de l'ordre signé conservé sur le site.
import type { TxClient } from '../db/gateway-tx';

export const MAX_LOCAL_ORDERS = 50;

export interface LocalOrderLine {
  type: 'LOCAL_UNSTALE' | 'PURGE';
  gateway_id: string;
  holders: [string, string];
  at: string;
  order_sha256: string;
}

interface AuditRow {
  id: string;
  at: Date;
  detail: Record<string, unknown>;
}

const HEX32 = /^[0-9a-f]{64}$/;

function toLine(row: AuditRow, gatewayId: string): LocalOrderLine | null {
  const d = row.detail ?? {};
  const holders = d.holders;
  if (d.order_kind !== 'LOCAL_UNSTALE' && d.order_kind !== 'PURGE') return null;
  if (
    !Array.isArray(holders) ||
    holders.length !== 2 ||
    !holders.every((h) => typeof h === 'string' && h !== '') ||
    holders[0] === holders[1]
  ) {
    return null;
  }
  if (typeof d.order_sha256 !== 'string' || !HEX32.test(d.order_sha256)) return null;
  return {
    type: d.order_kind,
    gateway_id: gatewayId,
    holders: [holders[0] as string, holders[1] as string],
    at: row.at.toISOString(),
    order_sha256: d.order_sha256,
  };
}

/** Lignes encore à verser, dans l'ordre d'écriture (au plus `MAX_LOCAL_ORDERS` valides). */
export async function pendingLocalOrders(tx: TxClient): Promise<LocalOrderLine[]> {
  const { rows } = await tx.query<AuditRow>(
    `SELECT id, at, detail FROM edge_audit
      WHERE kind = 'SITE_ORDER_ACCEPTED' AND sent_in_batch IS NULL ORDER BY id`,
  );
  if (rows.length === 0) return [];
  const meta = await tx.query<{ gateway_id: string }>('SELECT gateway_id FROM edge_meta');
  const gatewayId = meta.rows[0]?.gateway_id ?? '';
  const lines: LocalOrderLine[] = [];
  for (const row of rows) {
    const line = toLine(row, gatewayId);
    if (line === null) {
      const seen = await tx.query(
        `SELECT 1 FROM edge_audit WHERE kind = 'LOCAL_ORDER_UNSENDABLE'
                                    AND detail->>'audit_id' = $1`,
        [row.id],
      );
      if (seen.rowCount === 0) {
        await tx.query(
          `INSERT INTO edge_audit (kind, actor, detail)
           VALUES ('LOCAL_ORDER_UNSENDABLE', 'gateway', $1)`,
          [JSON.stringify({ audit_id: row.id })],
        );
      }
      continue;
    }
    if (lines.length < MAX_LOCAL_ORDERS) lines.push(line);
  }
  return lines;
}

/** Résultats du lot reçus : les ordres qu'il portait (lus dans son corps conservé) sont versés. */
export async function markLocalOrdersSent(tx: TxClient, batchId: string): Promise<void> {
  const { rows } = await tx.query<{ body: string | null }>(
    'SELECT body FROM edge_outgoing_batch WHERE batch_id = $1',
    [batchId],
  );
  const body = rows[0]?.body;
  if (!body) return;
  let hashes: string[];
  try {
    const parsed = JSON.parse(body) as { local_orders?: Array<{ order_sha256?: unknown }> };
    hashes = (parsed.local_orders ?? [])
      .map((line) => line.order_sha256)
      .filter((h): h is string => typeof h === 'string');
  } catch {
    return;
  }
  if (hashes.length === 0) return;
  await tx.query(
    `UPDATE edge_audit SET sent_in_batch = $1
      WHERE kind = 'SITE_ORDER_ACCEPTED' AND sent_in_batch IS NULL
        AND detail->>'order_sha256' = ANY($2::text[])`,
    [batchId, hashes],
  );
}
