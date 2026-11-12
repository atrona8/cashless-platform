// Ce que la réception des lots lit ou écrit et que le rôle `cashless_edge` ne peut pas atteindre par une table (il n'a
// AUCUN droit de table, WP09) : curseur du registre, clé publique d'un terminal, résultats mémorisés d'un lot, configuration
// des frais, audit. Adaptateur de production : `PgEdgeSyncCentral` (fonctions SQL étroites `SECURITY DEFINER`,
// migration 0066, décision 39). Un faux (`isFake = true`, tests) est refusé en production par `assertProcessIsSafe`.
import type { EdgeGateway } from '../auth/edge-gateway';

/**
 * Curseur du registre de la passerelle : dernier numéro contigu et dernière empreinte de chaîne du
 * central.
 */
export interface SyncCursor {
  contiguousEdgeSeq: bigint;
  /** `null` : aucune opération reçue encore (la chaîne part de la genèse). */
  lastChainHash: Buffer | null;
}

/**
 * Terminal de l'événement de la passerelle, lu par son numéro de série (jamais d'un autre
 * événement).
 */
export interface DeviceFacts {
  deviceId: string;
  /** SPKI DER de la clé de signature du terminal. */
  publicKey: Buffer | null;
  status: string;
}

export interface StoredResult {
  edgeSeq: bigint;
  outcome: 'ACCEPTED' | 'ACCEPTED_WITH_SHORTFALL' | 'DUPLICATE' | 'REJECTED' | 'VOID';
  reason: string | null;
  detail: string | null;
  transactionId: string | null;
  retryable: boolean;
}

/** Ligne de frais ou de commission, telle que `p_fee_lines` l'attend. */
export interface FeeLine {
  account_id: string;
  amount: number;
  fee_rule_id: string | null;
  memo: string | null;
}

export interface FeeInput {
  deviceSerial: string;
  amount: bigint;
  occurredAt: Date;
  currency: string;
}

export interface CentralAudit {
  action: 'EDGE_CHAIN_BROKEN' | 'EDGE_BATCH_SIGNATURE_INVALID' | 'EDGE_LOCAL_ORDER_RECORDED';
  /** Lot concerné. */
  batchId: string;
  detail: Record<string, unknown>;
}

export interface EdgeSyncCentral {
  readonly isFake?: boolean;
  cursor(gateway: EdgeGateway): Promise<SyncCursor>;
  device(gateway: EdgeGateway, serial: string): Promise<DeviceFacts | null>;
  /**
   * Frais et commissions recalculés par le moteur central (règle active, bonne portée, bonne
   * période, bon payeur).
   */
  feeLines(gateway: EdgeGateway, input: FeeInput): Promise<FeeLine[]>;
  results(gateway: EdgeGateway, batchId: string): Promise<StoredResult[]>;
  audit(gateway: EdgeGateway, entry: CentralAudit): Promise<void>;
}

export const EDGE_SYNC_CENTRAL = Symbol('EDGE_SYNC_CENTRAL');
