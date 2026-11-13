// Lecture de l'autorité de débit vue par une passerelle (`DebitAuthorityState`, contrat inchangé) : par les seules
// enveloppes `get_debit_authority` et `get_current_edge_handover` (cashless_edge n'a aucun droit de table). Un seul
// handover (priorité A13 décidée en base). Les entiers 64 bits sortent en nombres (sûrs : époques et filigranes).
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../../db/tenant-tx';
import type { EdgeGateway } from '../auth/edge-gateway';
import { EdgeTx } from '../edge-tx';

export interface HandoverView {
  handover_id: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  state: string;
  epoch: number;
  central_watermark_posting_id?: number;
  final_edge_seq?: number;
  requested_at: string;
  completed_at?: string;
}

export interface DebitAuthorityState {
  ledger_id: string | null;
  authority: 'CENTRAL' | 'EDGE';
  epoch: number;
  edge_gateway_id: string | null;
  edge_base_url: string | null;
  handover: HandoverView | null;
}

interface AuthorityRow {
  ledger_id: string;
  authority: 'CENTRAL' | 'EDGE';
  epoch: bigint | number;
  edge_gateway_id: string | null;
  lan_url: string | null;
}

interface HandoverRow {
  id: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  status: string;
  epoch: number;
  watermark_posting_id: bigint | number | null;
  final_edge_seq: bigint | number | null;
  requested_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/** Ce qui identifie un état : égal à l'entrée = rien de nouveau depuis le dernier état vu. */
export interface ObservedState {
  state: DebitAuthorityState;
  fingerprint: string;
}

const num = (value: bigint | number): number => Number(value);

@Injectable()
export class DebitAuthorityReader {
  constructor(private readonly tx: EdgeTx) {}

  /** Dans la transaction `client` déjà bornée à la passerelle (`EdgeTx.run`). */
  async readIn(
    client: TxClient,
    gateway: EdgeGateway,
    ledgerId: string | null,
  ): Promise<ObservedState> {
    const handovers = await client.query<HandoverRow>(
      'SELECT * FROM get_current_edge_handover($1)',
      [gateway.gatewayId],
    );
    let authority: AuthorityRow | undefined;
    if (ledgerId !== null) {
      const { rows } = await client.query<AuthorityRow>('SELECT * FROM get_debit_authority($1)', [
        ledgerId,
      ]);
      authority = rows[0];
    }
    const row = handovers.rows[0];
    const handover: HandoverView | null = row
      ? {
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
        }
      : null;
    const state: DebitAuthorityState = {
      ledger_id: authority?.ledger_id ?? ledgerId,
      authority: authority?.authority ?? 'CENTRAL',
      epoch: authority ? num(authority.epoch) : 0,
      edge_gateway_id: authority?.edge_gateway_id ?? null,
      edge_base_url: authority?.lan_url ?? null,
      handover,
    };
    const fingerprint = JSON.stringify([
      state.authority,
      state.epoch,
      state.edge_gateway_id,
      row ? [row.id, row.status, row.epoch, row.updated_at.toISOString()] : null,
    ]);
    return { state, fingerprint };
  }

  /** Une lecture en transaction courte, bornée à la passerelle. */
  read(gateway: EdgeGateway): Promise<ObservedState> {
    return this.tx.run(gateway, (client) => this.readIn(client, gateway, gateway.ledgerId));
  }
}
