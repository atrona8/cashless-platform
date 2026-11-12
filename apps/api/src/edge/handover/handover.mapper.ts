// Mise en forme des réponses de bascule (WP12) : une ligne `debit_authority_handover` rendue par une enveloppe
// `edge_*` devient la vue `Handover` du contrat, et l'autorité du grand livre vient de `get_debit_authority`.
// Aucune table n'est lue : seulement ce que les enveloppes rendent. Les entiers 64 bits sortent en nombres (époques et
// numéros d'écritures : sûrs).
import type { TxClient } from '../../db/tenant-tx';
import type { EdgeGateway } from '../auth/edge-gateway';
import type { DebitAuthorityState, HandoverView } from '../control/debit-authority-reader';

/** Ligne de `debit_authority_handover` rendue par `edge_ack_handover`, `begin_edge_release`, `edge_complete_release`. */
export interface HandoverRow {
  id: string;
  ledger_id: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  status: string;
  epoch: bigint | number;
  watermark_posting_id: bigint | number | null;
  final_edge_seq: bigint | number | null;
  requested_at: Date;
  completed_at: Date | null;
}

const num = (value: bigint | number): number => Number(value);

export function handoverView(row: HandoverRow): HandoverView {
  return {
    handover_id: row.id,
    direction: row.direction,
    state: row.status,
    epoch: num(row.epoch),
    ...(row.watermark_posting_id !== null
      ? { central_watermark_posting_id: num(row.watermark_posting_id) }
      : {}),
    ...(row.final_edge_seq !== null ? { final_edge_seq: num(row.final_edge_seq) } : {}),
    requested_at: row.requested_at.toISOString(),
    ...(row.completed_at ? { completed_at: row.completed_at.toISOString() } : {}),
  };
}

/** `DebitAuthorityState` : autorité courante du grand livre de la passerelle et le handover qui vient d'agir. */
export async function stateAfter(
  client: TxClient,
  gateway: EdgeGateway,
  row: HandoverRow,
): Promise<DebitAuthorityState> {
  const { rows } = await client.query<{
    ledger_id: string;
    authority: 'CENTRAL' | 'EDGE';
    epoch: bigint | number;
    edge_gateway_id: string | null;
    lan_url: string | null;
  }>('SELECT * FROM get_debit_authority($1)', [row.ledger_id]);
  const authority = rows[0];
  return {
    ledger_id: authority?.ledger_id ?? row.ledger_id,
    authority: authority?.authority ?? 'CENTRAL',
    epoch: authority ? num(authority.epoch) : 0,
    edge_gateway_id: authority?.edge_gateway_id ?? null,
    edge_base_url: authority?.lan_url ?? null,
    handover: handoverView(row),
  };
}
