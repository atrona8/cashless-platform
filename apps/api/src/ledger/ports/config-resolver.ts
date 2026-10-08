// Port : configuration en vigueur à la date de l'opération (SPECIFICATION §5.4, étape 2 : figer la configuration).
//
// Aucune implémentation réelle dans cette mission (lecture de fee_rule / config_version : mission 3). Les seules
// implémentations sont des fixtures : celle du scénario de référence (WP13) et une fixture minimale de test (WP12).
import type { ResolvedConfig } from '../types';

export interface ConfigQuery {
  ledgerId: string;
  eventId?: string;
  occurredAt: Date;
  participationId?: string;
}

export interface ConfigResolver {
  resolve(query: ConfigQuery): Promise<ResolvedConfig>;
}

/** Jeton d'injection NestJS (le module qui fournit l'implémentation le déclare). */
export const CONFIG_RESOLVER = Symbol('CONFIG_RESOLVER');
