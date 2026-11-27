// Exécution d'un essai (WP11, T048) : force les réglages « réel, hors production », choisit le parcours du service
// et assemble le compte rendu. Ne touche ni `PRODUCTION_ENABLED_SERVICES` ni la garde de production : l'essai vise le
// vrai service depuis un poste d'exploitation, jamais depuis un processus de production.
import type { AppConfig } from '../../config/config';
import { runKmsTrial, runSealCopyTrial } from './aws-trial';
import type { TrialContext, TrialOptions } from './context';
import { isPspService, runPspTrial, runSecretsTrial } from './psp-trial';
import type { Recorder, TrialReport } from './report';
import type { ExternalService } from '../services';

export const PAYDUNYA_PRODUCTION_BASE = 'https://app.paydunya.com/api/v1';
export const PAYDUNYA_SANDBOX_BASE = 'https://app.paydunya.com/sandbox-api/v1';

export interface TrialDeps {
  config: AppConfig;
  readFile(path: string): string;
  now(): Date;
  newId(): string;
}

/**
 * `--sandbox` : base bac à sable de PayDunya, seulement si la base n'a pas été posée explicitement (un faux serveur
 * local ou une autre adresse gardent la main). Rend les bases et si le bac à sable est effectivement utilisé.
 */
export function resolvePspBases(
  bases: AppConfig['pspBases'],
  sandbox: boolean,
): { bases: AppConfig['pspBases']; sandboxUsed: boolean } {
  if (sandbox && bases.paydunya === PAYDUNYA_PRODUCTION_BASE)
    return { bases: { ...bases, paydunya: PAYDUNYA_SANDBOX_BASE }, sandboxUsed: true };
  return { bases, sandboxUsed: false };
}

/** Un essai en bac à sable ne prouve pas le service réel : son nom ne correspond à aucun fichier de `docs/essais/`. */
export function reportServiceName(service: string, sandboxUsed: boolean): string {
  return sandboxUsed ? `${service}.sandbox` : service;
}

export interface TrialResult {
  report: TrialReport;
  /** Valeurs qui ne doivent jamais figurer dans la sortie. */
  seen: string[];
}

export async function runTrial(
  service: ExternalService,
  options: TrialOptions,
  deps: TrialDeps,
): Promise<TrialResult> {
  if (deps.config.production) throw new Error('essai refusé en production');
  const { bases, sandboxUsed } = resolvePspBases(deps.config.pspBases, options.sandbox);
  const config: AppConfig = {
    ...deps.config,
    production: false,
    pspBases: bases,
    externalModes: { psp: 'real', pspSecrets: 'real', kms: 'real', sealCopy: 'real' },
  };
  const ctx: TrialContext = {
    config,
    options,
    readFile: deps.readFile,
    clock: () => deps.now().getTime(),
    newId: () => `essai-${deps.newId()}`,
    seen: [],
  };
  const startedAt = deps.now().toISOString();
  let rec: Recorder;
  if (isPspService(service)) rec = await runPspTrial(ctx, service);
  else if (service === 'psp.secrets') rec = await runSecretsTrial(ctx);
  else if (service === 'kms') rec = await runKmsTrial(ctx);
  else rec = await runSealCopyTrial(ctx);
  const name = reportServiceName(service, sandboxUsed);
  return {
    report: {
      service: name,
      startedAt,
      steps: rec.steps,
      ok: rec.steps.length > 0 && rec.steps.every((step) => step.ok),
    },
    seen: ctx.seen,
  };
}
