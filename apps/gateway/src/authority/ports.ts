// Interfaces que ce lot consomme et que d'autres lots fournissent (interfaces.md § 13.9). Aucun
// import de `replication/**` ni de `queue/**` : pas de cycle entre lots.

/** Fournie par WP18 (`apps/gateway/src/replication/`) sous le jeton `REPLICATION_CATCH_UP`. */
export interface ReplicationCatchUp {
  /** Revient quand le curseur de réplication a atteint `watermark` (identifiant d'écriture). */
  catchUpTo(watermark: bigint): Promise<void>;
}
export const REPLICATION_CATCH_UP = Symbol('REPLICATION_CATCH_UP');

/**
 * Lecture seule de la file des décisions (WP20 peut fournir la sienne sous `QUEUE_PROBE`). Défaut
 * de ce lot : lecture de `edge_chain_head` et de `edge_outgoing_batch`.
 */
export interface QueueProbe {
  isEmpty(): Promise<boolean>;
}
export const QUEUE_PROBE = Symbol('QUEUE_PROBE');

/** Signal à `DrainService` (WP20) : `RELEASING` persisté, ou des numéros manquent au central. */
export interface DrainSignal {
  requestDrain(hint?: { missingEdgeSeqs?: number[] }): void | Promise<void>;
}
export const DRAIN_SIGNAL = Symbol('DRAIN_SIGNAL');

/** Défaut tant que WP18 n'est pas branché : REFUSE (aucun accusé ne part sans rattrapage réel). */
export class CatchUpUnavailableError extends Error {
  constructor() {
    super('rattrapage de la réplication indisponible : accusé de bascule non envoyé');
    this.name = 'CatchUpUnavailableError';
  }
}
export const unavailableCatchUp: ReplicationCatchUp = {
  catchUpTo(): Promise<void> {
    return Promise.reject(new CatchUpUnavailableError());
  },
};
