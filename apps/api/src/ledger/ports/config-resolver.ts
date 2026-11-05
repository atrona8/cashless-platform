// Port : configuration en vigueur à la date de l'opération (SPECIFICATION §5.4, étape 2 : figer la configuration).
//
// Implémentation réelle : `SqlConfigResolver` (configuration/, mission configuration-parties-evenements). Les
// fixtures restent pour les tests du moteur : celle du scénario de référence et une fixture minimale.
import type { Queryable } from './account-resolver';
import type { ReferenceMemo } from './reference-memo';
import type { ResolvedConfig } from '../types';

export interface ConfigQuery {
  ledgerId: string;
  eventId?: string;
  occurredAt: Date;
  participationId?: string;
  /** Configuration PSP figée par la recharge (`metadata.psp_configuration_id`) : porte la règle de frais. */
  pspConfigurationId?: string;
  /** Client de la transaction de l'écriture : le résolveur réel lit la configuration sous le même prestataire. */
  client?: Queryable;
  /**
   * Mémoire de lot (hors ligne seulement) : le résolveur y garde les lectures d'objets IMMUABLES (contrat, profil de
   * législation, partie plateforme). Absente (chemin en ligne) : tout est relu, comme avant.
   */
  memo?: ReferenceMemo;
  /**
   * Ne lit pas les droits de place (inutiles hors `PITCH_FEE`) : `config.pitchFees` lève alors à la lecture au lieu de
   * rendre un faux `{}`. Posé par le contexte de lot hors ligne, jamais par le chemin en ligne.
   */
  skipPitchFees?: boolean;
}

export interface ConfigResolver {
  resolve(query: ConfigQuery): Promise<ResolvedConfig>;
}

/** Jeton d'injection NestJS (le module qui fournit l'implémentation le déclare). */
export const CONFIG_RESOLVER = Symbol('CONFIG_RESOLVER');
