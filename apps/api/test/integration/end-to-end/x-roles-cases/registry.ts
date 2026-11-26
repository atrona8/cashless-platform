// Registre des cas de la matrice `x-roles` (mission routes-backoffice, WP10 ; FR-003, FR-004, SC-002 ; research D3).
// Chaque domaine dépose un fichier `<domaine>.cases.ts` dans ce dossier, sans index à éditer : le registre lit le
// dossier. Un fichier exporte `cases: XRolesCase[]`. Deux cas pour une même opération : échec explicite.
//
// RÈGLE DE CHOIX DES APPELS (D3, matrice échantillon) : D3 prévoit un échantillon d'environ 470 appels (au plus trois
// rôles déclarés : haut, intermédiaire, bas ; le rôle non déclaré le plus proche en droits). La suite mesurée tient
// environ 1 300 appels en une vingtaine de secondes : l'échantillon est donc ÉLARGI à tout le personnel de la liste
// fermée (7 rôles : PLATFORM_ADMIN, OPERATOR_ADMIN, ORGANIZER_ADMIN, MERCHANT_ADMIN, SUPERVISOR, CASHIER,
// PERSONALIZER) pour chaque opération qui déclare au moins un de ces rôles. Un rôle déclaré n'est jamais refusé POUR
// DROIT ; un rôle non déclaré l'est. Les appelants d'une autre nature (DEVICE, VENDOR, CUSTOMER, GATEWAY) ne sont pas
// rejoués ici (leurs preuves sont celles de `device-auth-matrix`, `payment-isolation`, `topup-isolation`, des suites
// du festivalier et de la passerelle) : le personnel est seulement refusé sur leurs routes (sonde, 401 ou 403).
//
// CODES 403 : seul `403 FORBIDDEN` (refus de rôle ou de portée du catalogue, `ProblemException('FORBIDDEN')`) vaut
// « refus pour droit ». Les autres 403 du catalogue (`DEVICE_SUSPENDED`, `DEVICE_REVOKED`, `OFFLINE_NOT_ALLOWED`,
// `APPROVAL_REQUIRED`…) ne sont pas des refus de droit : un rôle déclaré qui les reçoit n'est pas en faute, un rôle
// non déclaré qui les reçoit n'est pas prouvé refusé. Un `404` n'est accepté comme refus d'un rôle non déclaré que
// là où le cas le déclare (`refusals`) avec sa raison : le serveur masque alors l'existence de l'objet.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export type StaffRole =
  | 'PLATFORM_ADMIN'
  | 'OPERATOR_ADMIN'
  | 'ORGANIZER_ADMIN'
  | 'MERCHANT_ADMIN'
  | 'SUPERVISOR'
  | 'CASHIER'
  | 'PERSONALIZER';

/** Du plus haut au plus bas ; ordre de lecture des rapports. */
export const STAFF_ROLES: readonly StaffRole[] = [
  'PLATFORM_ADMIN',
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'MERCHANT_ADMIN',
  'SUPERVISOR',
  'CASHIER',
  'PERSONALIZER',
];

export type CaseMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Ce que le cas peut lire : identifiants des objets de la suite (portée de l'appelant), par nom de paramètre. */
export interface XRolesFixture {
  /** Identifiants par nom de paramètre de chemin (`operator_id`, `event_id`…). */
  readonly ids: Readonly<Record<string, string>>;
  /** Corps d'une lecture du bracelet du jeu d'essai (`tap`), compteur croissant. */
  tap(): Record<string, unknown>;
  /** Amorçage en propriétaire (objets que la route désigne et qu'un appel déclaré peut consommer). */
  owner<T>(fn: (db: import('pg').Client) => Promise<T>): Promise<T>;
  /** Appel de préparation par l'API, au nom d'un rôle du personnel (crée une demande, une personne…). */
  call(
    role: StaffRole,
    call: PreparedCall,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  /** Prestataire A, personne cible d'une attribution de rôle, créée à la demande. */
  newTargetUser(): Promise<string>;
}

export interface PreparedCall {
  method: CaseMethod;
  path: string;
  body?: unknown;
  /** Terminal autre que celui du guichet par défaut (`other` : second terminal, sa propre session de caisse). */
  terminal?: 'desk' | 'other';
  /** En-têtes en plus de l'authentification et de la clé d'idempotence. */
  headers?: Record<string, string>;
}

export interface XRolesCase {
  operationId: string;
  /**
   * Aucun rôle du personnel n'est déclaré (ou aucune route : doute accepté) : rien n'est joué pour les rôles ; la
   * raison est écrite ici. Le spec sonde que le personnel est refusé (401 ou 403) sur une route servie.
   */
  external?: string;
  /**
   * Route de guichet : terminal du monde de test ET personne (`X-Staff-Authorization`). Une fonction du rôle pour les
   * routes qui admettent la personne seule OU le terminal avec la personne (le transport dépend alors du rôle joué).
   */
  device?: boolean | ((role: StaffRole) => boolean);
  /** Processus qui sert la route (défaut : l'API). */
  server?: 'api' | 'personalization';
  /**
   * Appel du cas. Par défaut : méthode et chemin du contrat, paramètres de chemin tirés de `fx.ids`, corps `{}`.
   * Elle ne dépend d'un rôle que si le contrôle lui-même en dépend (corps) ; l'objet visé reste dans la portée de
   * tous les rôles joués.
   */
  prepare?(fx: XRolesFixture, role: StaffRole): PreparedCall | Promise<PreparedCall>;
  /**
   * Corps de forme valide tiré du schéma du contrat (`schema-body.ts`) au lieu de `{}` : à poser quand le service juge
   * le droit APRÈS la validation du corps (sinon un rôle non déclaré recevrait 400 avant tout contrôle de droit).
   */
  validBody?: boolean;
  /**
   * Opération non jouable sous l'identité de test, raison écrite : aucun rôle n'est rejoué ici (preuve ailleurs :
   * suites HTTPS à identité réelle). Listée dans la sortie du spec et reprise en WP11 (point ouvert).
   */
  unplayable?: string;
  /**
   * Rôles déclarés par UNION sur plusieurs actions (approbations) : pour l'action jouée, ils peuvent être refusés à
   * juste titre ; ils ne sont alors pas exigés « admis ». Raison dans `note`.
   */
  conditionalRoles?: StaffRole[];
  /**
   * Lecture filtrée par rôle : un rôle non déclaré reçoit `200` avec une liste VIDE (`items`), jamais de donnée ;
   * la matrice exige cette liste vide alors qu'une demande existe (`prepare` en crée une).
   */
  emptyForUndeclared?: boolean;
  /**
   * Preuve PARTIELLE, raison écrite : le rôle non déclaré est seulement exigé « non réussi » (ni 2xx ni 5xx), faute de
   * pouvoir amorcer l'objet réel. Listée dans la sortie du spec et reprise en WP11 (point ouvert).
   */
  partial?: string;
  /** Statuts de refus acceptés pour un rôle non déclaré EN PLUS de `403 FORBIDDEN` (404 qui masque l'existence). */
  refusals?: number[];
  /** Pourquoi le cas s'écarte du défaut. */
  note?: string;
}

/** Fichiers `*.cases.ts` du dossier (triés : ordre stable). */
export function caseFiles(dir: string = __dirname): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.cases.ts'))
    .sort();
}

function isCaseFile(value: unknown): value is { cases: XRolesCase[] } {
  const v = value as { cases?: unknown } | null;
  return typeof v === 'object' && v !== null && Array.isArray(v.cases);
}

export interface LoadedCases {
  cases: Record<string, XRolesCase>;
  /** Fichier de chaque opération (journal et messages d'échec). */
  origin: Record<string, string>;
  files: string[];
}

/** Cas de tous les fichiers du dossier, par `operationId` ; doublon → erreur. */
export function loadCases(
  dir: string = __dirname,
  // Lecture synchrone du dossier sous Jest (CommonJS), sans index à éditer.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  load: (path: string) => unknown = (path) => require(path) as unknown,
): LoadedCases {
  const cases: Record<string, XRolesCase> = {};
  const origin: Record<string, string> = {};
  const files = caseFiles(dir);
  for (const file of files) {
    const module = load(join(dir, file));
    if (!isCaseFile(module)) throw new Error(`${file} : « cases: XRolesCase[] » attendu`);
    for (const c of module.cases) {
      const previous = origin[c.operationId];
      if (previous !== undefined)
        throw new Error(`${file} : opération « ${c.operationId} » déjà couverte (${previous})`);
      origin[c.operationId] = file;
      cases[c.operationId] = c;
    }
  }
  return { cases, origin, files };
}
