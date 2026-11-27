// Compte rendu d'essai d'un service externe (mission 12b-1, WP11 ; interfaces.md §7, FR-014). Forme :
// `{ service, startedAt, steps: [{ name, ok, httpStatus?, durationMs }], ok }`, prête à être commitée sous
// `docs/essais/<service>.json`. Jamais de secret, de référence de secret, de nom de compartiment ni de corps :
// une étape en échec porte un MOTIF COURT tiré d'une liste fermée (`reasonOf`), jamais le message d'une erreur.
import { PspHttpError } from '../../psp/http/psp-http';
import { PspProviderError } from '../../psp/psp-errors';
import { PspSecretError } from '../../psp/psp-secret-store.port';
import { KmsKeyError, KmsUnavailableError } from '../../kms/kms.ports';

export interface TrialStep {
  name: string;
  ok: boolean;
  httpStatus?: number;
  durationMs: number;
  /** Motif court d'un échec ou d'une étape sautée (liste fermée, sans secret). */
  reason?: string;
}

export interface TrialReport {
  service: string;
  startedAt: string;
  steps: TrialStep[];
  ok: boolean;
}

/** Échec logique d'une étape (résultat inattendu) : le code est un motif court choisi par le code, jamais un texte reçu. */
export class StepFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StepFailure';
  }
}

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,28}$/;
const safe = (value: unknown, fallback: string): string =>
  typeof value === 'string' && SAFE_CODE.test(value) ? value : fallback;

/** Motif court d'une erreur : ni message libre du fournisseur, ni URL, ni identifiant, ni corps. */
export function reasonOf(error: unknown): string {
  if (error instanceof StepFailure) return safe(error.code, 'echec');
  if (error instanceof PspProviderError) return `psp.${error.kind.toLowerCase()}`;
  if (error instanceof PspHttpError)
    return `http.${error.kind.toLowerCase()}.${safe(error.code, 'inconnu')}`;
  if (error instanceof PspSecretError) return `secret.${error.code.toLowerCase()}`;
  if (error instanceof KmsKeyError || error instanceof KmsUnavailableError) {
    const found = /\(([A-Za-z]+) : ([A-Za-z0-9_.]+)\)/.exec(error.message);
    const kind = error instanceof KmsKeyError ? 'cle' : 'service';
    return found === null ? `kms.${kind}` : `kms.${kind}.${found[1]}.${safe(found[2], 'inconnu')}`;
  }
  if (error instanceof Error) {
    const s3 = /^copie des scellements \(([a-z]+)\) : ([A-Za-z0-9_.]+)$/.exec(error.message);
    if (s3 !== null) return `s3.${s3[1]}.${safe(s3[2], 'inconnu')}`;
    if (error.message === 'copie de scellement divergente') return 's3.divergente';
  }
  return 'erreur.inconnue';
}

export interface StatusProbe {
  reset(): void;
  status(): number | undefined;
}

/** Enregistre les étapes ; une étape dont une dépendance n'est pas `ok` est sautée (`ok: false`, motif `sautee`). */
export class Recorder {
  readonly steps: TrialStep[] = [];

  constructor(
    private readonly probe: StatusProbe | null = null,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  succeeded(name: string): boolean {
    return this.steps.some((step) => step.name === name && step.ok);
  }

  async run<T>(
    name: string,
    fn: () => Promise<T>,
    needs: readonly string[] = [],
  ): Promise<T | undefined> {
    if (needs.some((need) => !this.succeeded(need))) {
      this.steps.push({ name, ok: false, durationMs: 0, reason: 'sautee' });
      return undefined;
    }
    this.probe?.reset();
    const started = this.clock();
    let value: T | undefined;
    let failure: string | null = null;
    try {
      value = await fn();
    } catch (error) {
      failure = reasonOf(error);
    }
    const httpStatus = this.probe?.status();
    this.steps.push({
      name,
      ok: failure === null,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      durationMs: Math.max(0, this.clock() - started),
      ...(failure === null ? {} : { reason: failure }),
    });
    return failure === null ? value : undefined;
  }
}

/**
 * Chaînes qui ressemblent à un secret : clé Stripe, secret de notification, clé Wave, clé AWS, jeton long. Les mêmes
 * motifs que la borne de `PRODUCTION_ENABLED_SERVICES` (test/unit/external-services/production-enabled.spec.ts) ;
 * `trial.spec.ts` vérifie qu'ils n'ont pas divergé.
 */
export const SECRET_LOOKING: readonly RegExp[] = [
  /sk_(live|test)_/,
  /rk_(live|test)_/,
  /whsec_/,
  /wave_sn_/,
  /AKIA[0-9A-Z]{8,}/,
  /ASIA[0-9A-Z]{8,}/,
  /[A-Za-z0-9_-]{30,}/,
];

/**
 * Violations de la forme du compte rendu (les mêmes règles que la borne de WP10 : service, `startedAt`, `ok`, étapes
 * bien formées et réussies, rien qui ressemble à un secret). La liste vide veut dire « commitable ».
 */
export function reportViolations(report: TrialReport, expectedService: string): string[] {
  const found: string[] = [];
  const text = JSON.stringify(report);
  if (report.service !== expectedService) found.push('champ service différent');
  if (Number.isNaN(Date.parse(report.startedAt))) found.push('startedAt absent ou invalide');
  if (report.ok !== true) found.push("ok n'est pas true");
  if (report.steps.length === 0) found.push('aucune étape');
  for (const step of report.steps) {
    if (step.name === '' || typeof step.durationMs !== 'number') found.push('étape mal formée');
    if (step.ok !== true) found.push(`étape ${step.name} non réussie`);
  }
  if (SECRET_LOOKING.some((pattern) => pattern.test(text)))
    found.push('le compte rendu ressemble à un secret');
  return found;
}

/** Vrai si le texte contient quelque chose qui ressemble à un secret (même liste que la borne de WP10). */
export function looksSecret(text: string): boolean {
  return SECRET_LOOKING.some((pattern) => pattern.test(text));
}
