// Registre des cas du balayage d'isolement de la mission routes-backoffice (11b, WP05 ; interfaces.md §5).
// Chaque lot de routes (WP06 à WP09) dépose un fichier `<lot>.cases.ts` dans ce dossier, sans rien éditer
// d'autre : le registre lit le dossier. Un fichier exporte `cases: BackofficeIsolationCase[]`. Deux cas pour
// une même opération : échec explicite. Ce fichier n'est modifié que par WP05.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaWorld } from '../../../support/media-fixtures';

/** Ce qu'un cas peut lire : le monde de test et ce que les lots y ont déposé. */
export interface BackofficeFixture {
  /** Prestataires A et B, leurs personnes, l'événement et le grand livre de A. */
  readonly w: MediaWorld;
  /** Valeurs déposées par `prepare` d'un cas (identifiants des objets de A), par nom. */
  readonly data: Record<string, string>;
  /** Valeurs de A qui ne doivent apparaître dans aucune réponse faite à B (`prepare` y ajoute). */
  readonly secrets: string[];
}

export type CaseMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface BackofficeIsolationCase {
  /** `operationId` du contrat, élément de `MISSION_11B_OPERATIONS`. */
  operationId: string;
  method: CaseMethod;
  /** Chemin sans le préfixe `/v1`, sur les objets de A. */
  path(fx: BackofficeFixture): string;
  /** Corps valide : le refus vient de l'isolement, pas de la validation. */
  body?(fx: BackofficeFixture): unknown;
  /** Amorçage des objets de A, une fois, avant les appels (renseigne `fx.data` et `fx.secrets`). */
  prepare?(fx: BackofficeFixture): Promise<void>;
  /**
   * Route qui ne désigne aucun objet (la personne appelante et son seul prestataire) : la personne de B reçoit
   * `200` avec SES données ; le balayage vérifie alors qu'aucune donnée de A n'y figure.
   */
  selfScoped?: boolean;
  /** Pourquoi le cas s'écarte du refus 403 ou 404. */
  note?: string;
}

/** Fichiers `*.cases.ts` du dossier (triés : ordre stable). */
export function caseFiles(dir: string = __dirname): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.cases.ts'))
    .sort();
}

function isCaseFile(value: unknown): value is { cases: BackofficeIsolationCase[] } {
  const v = value as { cases?: unknown } | null;
  return typeof v === 'object' && v !== null && Array.isArray(v.cases);
}

export interface LoadedCases {
  cases: Record<string, BackofficeIsolationCase>;
  /** Fichiers lus (journal du test). */
  files: string[];
}

/** Cas de tous les fichiers du dossier, par `operationId` ; doublon → erreur. */
export function loadCases(
  dir: string = __dirname,
  // Lecture synchrone du dossier sous Jest (CommonJS), sans index à éditer.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  load: (path: string) => unknown = (path) => require(path) as unknown,
): LoadedCases {
  const cases: Record<string, BackofficeIsolationCase> = {};
  const origin = new Map<string, string>();
  const files = caseFiles(dir);
  for (const file of files) {
    const module = load(join(dir, file));
    if (!isCaseFile(module))
      throw new Error(`${file} : « cases: BackofficeIsolationCase[] » attendu`);
    for (const c of module.cases) {
      const previous = origin.get(c.operationId);
      if (previous !== undefined)
        throw new Error(`${file} : opération « ${c.operationId} » déjà couverte (${previous})`);
      origin.set(c.operationId, file);
      cases[c.operationId] = c;
    }
  }
  return { cases, files };
}
