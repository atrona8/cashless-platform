// Jetons d'injection facultatifs que les lots suivants fournissent à ce lot (interfaces.md § 4).
// Sans eux, ce lot ne prétend rien : aucune version de snapshot (`null`) et aucune clé de snapshot
// (`snapshot_keys` vide, donc `offline_enabled` servi `false` : refus par défaut).
import type { TxClient } from '../db/gateway-tx';

/** Fourni par WP23 : version du snapshot local le plus récent pour ce terminal. */
export interface LocalSnapshotState {
  latestVersion(tx: TxClient, deviceId: string): Promise<number | null>;
}
export const LOCAL_SNAPSHOT_STATE = Symbol('LOCAL_SNAPSHOT_STATE');

export interface SnapshotKeyView {
  key_id: string;
  algorithm: 'ECDSA_P256_SHA256';
  /** SPKI DER en base64 standard, sur une ligne. */
  public_key: string;
  not_after: string | null;
}

/** Fourni par WP23 : clés publiques de snapshot de la passerelle (`owner = EDGE`). */
export interface GatewaySnapshotKeys {
  list(tx: TxClient): Promise<SnapshotKeyView[]>;
}
export const GATEWAY_SNAPSHOT_KEYS = Symbol('GATEWAY_SNAPSHOT_KEYS');
