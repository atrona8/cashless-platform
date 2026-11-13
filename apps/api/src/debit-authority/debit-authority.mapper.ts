// Lignes SQL → schémas `DebitAuthorityState` et `Handover` du contrat (mission passerelle-locale, lot WP11, T047).
// Aucun secret ni empreinte de chaîne dans la réponse : l'état, l'époque, la passerelle et l'URL locale seulement.

/** Ligne de `get_debit_authority(ledger)` (bigint rendus en texte par `pg`). */
export interface AuthorityRow {
  ledger_id: string;
  authority: 'CENTRAL' | 'EDGE';
  epoch: string | number;
  edge_gateway_id: string | null;
  lan_url: string | null;
}

/** Ligne de `debit_authority_handover` (colonnes lues seulement). */
export interface HandoverRow {
  id: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  status: string;
  epoch: number;
  watermark_posting_id: string | number | null;
  final_edge_seq: string | number | null;
  requested_at: Date;
  completed_at: Date | null;
}

export interface HandoverDto {
  handover_id: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  state: string;
  epoch: number;
  central_watermark_posting_id?: number;
  final_edge_seq?: number;
  requested_at: Date;
  completed_at?: Date;
}

export interface DebitAuthorityStateDto {
  ledger_id: string;
  authority: 'CENTRAL' | 'EDGE';
  epoch: number;
  edge_gateway_id: string | null;
  edge_base_url: string | null;
  handover: HandoverDto | null;
}

export function handoverDto(row: HandoverRow | null): HandoverDto | null {
  if (!row) return null;
  return {
    handover_id: row.id,
    direction: row.direction,
    state: row.status,
    epoch: Number(row.epoch),
    ...(row.watermark_posting_id !== null
      ? { central_watermark_posting_id: Number(row.watermark_posting_id) }
      : {}),
    ...(row.final_edge_seq !== null ? { final_edge_seq: Number(row.final_edge_seq) } : {}),
    requested_at: row.requested_at,
    ...(row.completed_at !== null ? { completed_at: row.completed_at } : {}),
  };
}

export function stateDto(
  authority: AuthorityRow,
  handover: HandoverRow | null,
): DebitAuthorityStateDto {
  return {
    ledger_id: authority.ledger_id,
    authority: authority.authority,
    epoch: Number(authority.epoch),
    edge_gateway_id: authority.edge_gateway_id,
    edge_base_url: authority.lan_url,
    handover: handoverDto(handover),
  };
}
