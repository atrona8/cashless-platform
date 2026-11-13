// Types des règles pures du hors ligne (mission 7, WP17 ; contracts/interfaces.md § 9).
// Aucune règle de ce dossier ne lit la base, l'horloge ni le réseau : tout arrive par arguments.
import type { components } from '@cashless/contracts';

export type OfflineRejectReason = components['schemas']['OfflineRejectReason'];
export type ShortfallReason = components['schemas']['ShortfallReason'];
// `interfaces.md` § 9 écrit `OperationType` et `TapResult` ; le contrat les nomme ainsi.
export type OperationType = components['schemas']['OfflineOperationType'];
export type TapResult = components['schemas']['TapResultCode'];

/**
 * Ce que le processeur de lots (WP19) lit en base pour une opération, regroupé par contrôle de
 * `contracts/compliance.md`. Aucun champ n'est une règle : ce sont des faits. Un fait absent
 * (`null`, `undefined`, `false`) REFUSE l'opération, jamais l'inverse.
 */
export interface ComplianceInput {
  /** `CONFIRMED` avec transaction en ligne existante (R-30.1) : conformité sautée. */
  exempt: boolean;
  type: OperationType;
  /** Montant de l'opération, en plus petite unité (bigint, jamais Number). */
  amount: bigint;
  /** Heure corrigée (`resolveOfflineTime`). */
  occurredAtCorrected: Date;
  /** Tolérance en millisecondes (120 000 par défaut, fournie par l'appelant). */
  tolMs: number;

  /** #1 : devises du portefeuille et de l'événement. */
  walletCurrency: string | null;
  eventCurrency: string | null;

  /** #2 : état daté du terminal (`device_status_at`), session de vendeur à cette heure. */
  device: {
    statusAtOccurred: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | string | null;
    vendorSessionOpen: boolean;
  };

  /** #3 : configuration en vigueur (`offline_config_in_force`) et celle citée par le tap. */
  tapConfigId: string | null;
  configInForce: {
    configId: string;
    offlineEnabled: boolean;
    maxPerSale: bigint;
    maxPerMedia: bigint;
    maxPerDevice: bigint;
  } | null;
  /**
   * Exposition DÉJÀ cumulée par `offline_device_exposure` (WP07), montant courant exclu :
   * opérations
   * de numéro inférieur, non rejetées, non `VOID`, nettes des annulations, résultat non rendu avant
   * `min(occurred_corrigé, received_at) − 120 s` (R-30.3).
   */
  exposure: { mediaCumulative: bigint; deviceCumulative: bigint };

  /** #4 et #5 : méta du snapshot cité par `snapshot_version` (`null` : version inconnue). */
  snapshot: {
    version: bigint;
    registeredAt: Date;
    envelopedForDevice: boolean;
    generatedAt: Date;
    validUntil: Date | null;
    /** Âge maximal de la politique, en millisecondes. */
    maxSnapshotAgeMs: number;
  } | null;
  /** Plancher d'accusé (R-30.4) : dernière version accusée avant `occurred − tol`, ou `null`. */
  ackFloor: bigint | null;

  /** #6 à #8 : état lu à la version utilisée (`offline_media_state_at`), jamais l'état courant. */
  mediaAtVersion: {
    present: boolean;
    mediaUsable: boolean;
    batchUsable: boolean;
    walletUsable: boolean;
    batchBelongsToEvent: boolean;
  };

  /** #9 : `tap.pack_verified` (absent = faux). */
  packVerified: boolean | null | undefined;

  /** #10 : seulement pour `REVERSAL` ; la cible doit être de CE terminal. */
  reversalTarget: { foundOnThisDevice: boolean; alreadyReversed: boolean } | null;
}
