// Port : configuration en vigueur à la date de l'opération (SPECIFICATION §5.4, étape 2 : figer la configuration).
//
// Implémentation réelle : `SqlConfigResolver` (configuration/, mission configuration-parties-evenements). Les
// fixtures restent pour les tests du moteur : celle du scénario de référence et une fixture minimale.
import type { Queryable } from './account-resolver';
import type { ResolvedConfig } from '../types';

export interface ConfigQuery {
  ledgerId: string;
  eventId?: string;
  occurredAt: Date;
  participationId?: string;
  /** Client de la transaction de l'écriture : le résolveur réel lit la configuration sous le même prestataire. */
  client?: Queryable;
}

export interface ConfigResolver {
  resolve(query: ConfigQuery): Promise<ResolvedConfig>;
}

/** Jeton d'injection NestJS (le module qui fournit l'implémentation le déclare). */
export const CONFIG_RESOLVER = Symbol('CONFIG_RESOLVER');
