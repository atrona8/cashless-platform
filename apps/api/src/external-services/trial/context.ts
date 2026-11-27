// Contexte d'une commande d'essai (WP11) : réglages, options de ligne de commande et dépendances injectables.
import type { AppConfig } from '../../config/config';
import type { PspProviderName } from '../../psp/psp.types';

export interface TrialOptions {
  sandbox: boolean;
  returnUrl?: string;
  notificationUrl?: string;
  secretRef?: string;
  credentialsFile?: string;
  provider?: PspProviderName;
  retentionDays?: number;
}

export interface TrialContext {
  /** Réglages déjà forcés : hors production, les quatre services en `real`. */
  config: AppConfig;
  options: TrialOptions;
  readFile(path: string): string;
  clock(): number;
  newId(): string;
  /** Valeurs à ne jamais retrouver dans la sortie (secrets lus, références, compartiment). */
  seen: string[];
}
