// Registre des cas de la matrice des preuves du terminal (mission 5b, lot WP08, T038 ; C-003 ;
// OP-N70). Chaque lot de routes de terminal (WP09 à WP13) dépose un fichier `<nom>.cases.ts` dans
// ce dossier, sans index à éditer : le registre lit le dossier. Un fichier exporte
// `controllers: string[]` (contrôleurs de terminal qu'il apporte) et `cases(ctx)` (un cas par route,
// clé `METHODE /chemin/{}`). Un fichier peut n'exporter aucun cas (`{}`).
// Doublon de clé de route entre fichiers, ou avec les cas de base de la matrice : échec explicite.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpsTestApp } from '../../../support/app';
import type { MediaWorld, SeededMedia } from '../../../support/media-fixtures';
import type { TestTerminal } from '../../../support/test-terminal';

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Méthodes qui portent un corps (variante « corps changé après la signature »). */
export const BODY_METHODS: ReadonlySet<RouteMethod> = new Set(['POST', 'PUT', 'PATCH']);
/** Méthodes d'écriture : `Idempotency-Key` envoyée. */
export const WRITE_METHODS: ReadonlySet<RouteMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Ce qu'un cas peut lire (rempli par la matrice dans son `beforeAll`). */
export interface CaseContext {
  /** Monde de test (prestataires, événement, personnes). */
  readonly w: MediaWorld;
  /** Terminal de la suite (trois preuves valides). */
  readonly terminal: TestTerminal;
  /** Bracelet personnalisé et activé de la suite. */
  readonly media: SeededMedia;
  /** API publique et processus des clés. */
  readonly api: HttpsTestApp;
  readonly keys: HttpsTestApp;
  /** Compteur croissant de la suite (`tap_id`, numéros). */
  next(): number;
  /** Clé `<serial>:<seq>` croissante du terminal (`TestTerminal.seqKey`). */
  seqKey(terminal: TestTerminal): string;
}

export interface RouteCase {
  /** Processus qui sert la route. */
  server: 'api' | 'keys';
  /** Route de guichet : jeton de la personne dans `X-Staff-Authorization` (`staffBearer`). */
  counter?: boolean;
  /** Route « terminal ou personne / festivalier » (garde exclusive `DeviceOrCallerGuard`). */
  exclusive?: 'person' | 'customer';
  path: () => string;
  body?: () => unknown;
  /** Statut attendu avec les trois preuves, quand la route sert l'objet du jeu d'essai. */
  ok?: number;
  /** `Idempotency-Key` d'une route d'écriture (défaut : un UUID) ; `who` : terminal qui envoie. */
  idempotencyKey?: (ctx: CaseContext, who: TestTerminal) => string;
  /** En-têtes facultatifs de la requête, hors preuves (ex. `X-Authority-Epoch` d'une opération de débit). */
  headers?: (ctx: CaseContext, who: TestTerminal) => Record<string, string>;
  /** Amorçage du cas (ex. session de vendeur), une fois, après celui de la matrice. */
  prepare?: (ctx: CaseContext) => Promise<void>;
}

export interface CaseFile {
  controllers: string[];
  cases(ctx: CaseContext): Record<string, RouteCase>;
}

export interface LoadedCases {
  cases: Record<string, RouteCase>;
  /** Contrôleurs apportés par les fichiers du registre. */
  controllers: string[];
  /** Fichiers lus (journal du test). */
  files: string[];
}

/** Fichiers `*.cases.ts` du dossier (triés : ordre stable). */
export function caseFiles(dir: string = __dirname): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.cases.ts'))
    .sort();
}

function isCaseFile(value: unknown): value is CaseFile {
  const v = value as Partial<CaseFile> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray(v.controllers) &&
    v.controllers.every((c) => typeof c === 'string') &&
    typeof v.cases === 'function'
  );
}

/** Cas de base de la matrice ∪ cas des fichiers du registre ; doublon → erreur. */
export function loadCases(
  base: Record<string, RouteCase>,
  ctx: CaseContext,
  dir: string = __dirname,
  // Lecture synchrone du dossier sous Jest (CommonJS), sans index à éditer.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  load: (path: string) => unknown = (path) => require(path) as unknown,
): LoadedCases {
  const cases: Record<string, RouteCase> = { ...base };
  const origin = new Map<string, string>(Object.keys(base).map((k) => [k, 'cas de base']));
  const controllers: string[] = [];
  const files = caseFiles(dir);
  for (const file of files) {
    const module = load(join(dir, file));
    if (!isCaseFile(module))
      throw new Error(`${file} : « controllers: string[] » et « cases(ctx) » attendus`);
    for (const controller of module.controllers) {
      if (controllers.includes(controller))
        throw new Error(`${file} : contrôleur ${controller} déjà déclaré par un autre fichier`);
      controllers.push(controller);
    }
    for (const [route, routeCase] of Object.entries(module.cases(ctx))) {
      const previous = origin.get(route);
      if (previous !== undefined)
        throw new Error(`${file} : route « ${route} » déjà déclarée (${previous})`);
      origin.set(route, file);
      cases[route] = routeCase;
    }
  }
  return { cases, controllers, files };
}
