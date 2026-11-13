// Garde de démarrage de la passerelle (interfaces.md § 8, data-model.md B.7-9, règle 2 du porteur :
// aucun faux en
// production). En production, REFUSE le démarrage pour : `HARDWARE_KEYSTORE=fake` ; un `EDGE_CA`
// factice ; un
// vérificateur d'identité de test ; `EDGE_FAILPOINT` ou `EDGE_ALLOW_FAILPOINTS` posés ;
// `CORS_ALLOW_ALL` ; l'écoute sans
// TLS ; `GATEWAY_REQUEST_AUTHORITY` à joker (`:*`, liste vide, plusieurs valeurs) ; un secret de
// test ; `fsync`,
// `full_page_writes` ou `synchronous_commit` désactivés sur la base locale (lus par `SHOW`) ; un
// rôle de base
// superutilisateur ; `NODE_ENV` absent ou hors énumération (refusé plus tôt, par `loadConfig`).
//
// Deux temps, tous deux AVANT toute ouverture de port :
//   1. `evaluateConfigRules` : règles sur la configuration et l'environnement, SANS connexion à la
// base ;
//   2. `evaluateServerRules` : réglages du serveur PostgreSQL local, lus sur une connexion nue
// (sans notre `SET`).
// Si le temps 1 refuse, le temps 2 n'a pas lieu (aucune connexion à la base). Chaque temps refuse
// TOUTES ses
// violations d'un coup : le message liste chacune, par le NOM du réglage, jamais par la valeur d'un
// secret.
//
// Un lot suivant qui ajoute un faux ajoute sa règle par `registerProductionRule(name, check)` :
// `check` rend le
// message de violation (sans valeur secrète) ou `null`. La règle n'est évaluée qu'en production.
import { unavailableCatchUp } from '../authority/ports';
import type { GatewayConfig } from '../config/config';
import { openBareConnection } from '../db/pool';

export interface GuardInput {
  config: GatewayConfig;
  env: Readonly<Record<string, string | undefined>>;
}
export type ProductionCheck = (input: GuardInput) => string | null;

const registry: Array<{ name: string; check: ProductionCheck }> = [];

/** Enregistre la règle de production d'un lot suivant (son faux éventuel). Appelé à l'import de son module. */
export function registerProductionRule(name: string, check: ProductionCheck): void {
  if (registry.some((rule) => rule.name === name))
    throw new Error(`règle déjà enregistrée : ${name}`);
  registry.push({ name, check });
}

export class StartupRefusedError extends Error {
  constructor(readonly violations: string[]) {
    super(`démarrage refusé en production :\n - ${violations.join('\n - ')}`);
    this.name = 'StartupRefusedError';
  }
}

/** Mots de passe publiés dans le dépôt ou les outils de développement : jamais en production. */
// Liste NON exhaustive (le mot de passe égal au nom du rôle est refusé en plus) : un secret fort relève de l'exploitant.
const TEST_SECRETS = [
  /^edge_app_local$/,
  /de-test-uniquement/,
  /^(test|changeme|password|postgres|edge_app|edge|admin|root|secret|cashless|gateway)$/i,
  /^[0-9]{1,12}$/,
];

function databaseUser(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return null;
  }
}

function databasePassword(url: string): string | null {
  try {
    const password = decodeURIComponent(new URL(url).password);
    return password === '' ? null : password;
  } catch {
    return null;
  }
}

/** `hôte:port` d'une seule adresse, sans joker : la valeur que les terminaux signent en `@authority`. */
export function authorityViolation(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return 'GATEWAY_REQUEST_AUTHORITY : liste vide';
  }
  if (value.includes(',')) return 'GATEWAY_REQUEST_AUTHORITY : plusieurs valeurs';
  if (value.includes('*')) return 'GATEWAY_REQUEST_AUTHORITY : joker interdit';
  const match = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    return 'GATEWAY_REQUEST_AUTHORITY : hôte:port d’une seule adresse attendu';
  }
  return null;
}

const BUILT_IN: Array<{ name: string; check: ProductionCheck }> = [
  {
    name: 'HARDWARE_KEYSTORE',
    check: ({ config }) =>
      config.hardwareKeystore === 'fake'
        ? 'HARDWARE_KEYSTORE=fake : faux interdit en production'
        : null,
  },
  {
    name: 'EDGE_CA',
    check: ({ config }) =>
      config.edgeCa !== null
        ? 'EDGE_CA : autorité de certification factice interdite en production'
        : null,
  },
  {
    name: 'GATEWAY_IDENTITY_VERIFIER',
    check: ({ config }) =>
      config.identityVerifier !== null
        ? 'GATEWAY_IDENTITY_VERIFIER : vérificateur d’identité de test interdit en production'
        : null,
  },
  {
    name: 'GATEWAY_DEV_KEY_FILE',
    check: ({ config }) =>
      config.devKeyFile !== null
        ? 'GATEWAY_DEV_KEY_FILE : fichier de clés du faux interdit en production'
        : null,
  },
  {
    name: 'EDGE_FAILPOINT',
    check: ({ config }) =>
      config.failpoint !== null
        ? 'EDGE_FAILPOINT : point d’arrêt posé, interdit en production'
        : null,
  },
  {
    name: 'EDGE_ALLOW_FAILPOINTS',
    check: ({ config }) =>
      config.allowFailpoints !== null
        ? 'EDGE_ALLOW_FAILPOINTS : activation des points d’arrêt interdite en production'
        : null,
  },
  {
    name: 'CORS_ALLOW_ALL',
    check: ({ env }) =>
      env.CORS_ALLOW_ALL !== undefined && env.CORS_ALLOW_ALL !== ''
        ? 'CORS_ALLOW_ALL : toutes origines interdit en production'
        : null,
  },
  {
    name: 'GATEWAY_TLS',
    check: ({ config }) =>
      config.tlsCertFile === null || config.tlsKeyFile === null
        ? 'GATEWAY_TLS_CERT_FILE / GATEWAY_TLS_KEY_FILE : écoute sans TLS interdite en production'
        : null,
  },
  {
    name: 'GATEWAY_REQUEST_AUTHORITY',
    check: ({ config }) => authorityViolation(config.requestAuthority),
  },
  {
    name: 'GATEWAY_DATABASE_URL',
    check: ({ config }) => {
      const password = databasePassword(config.databaseUrl);
      if (password === null) {
        return 'GATEWAY_DATABASE_URL : mot de passe vide interdit en production';
      }
      return TEST_SECRETS.some((re) => re.test(password)) ||
        password === databaseUser(config.databaseUrl)
        ? 'GATEWAY_DATABASE_URL : secret de test ou trivial interdit en production'
        : null;
    },
  },
  {
    name: 'GATEWAY_CENTRAL_URL',
    check: ({ config }) =>
      config.centralUrl !== null && !config.centralUrl.startsWith('https://')
        ? 'GATEWAY_CENTRAL_URL : https obligatoire en production'
        : null,
  },
  {
    name: 'GATEWAY_IDENTITY_JWKS_URL',
    check: ({ config }) =>
      config.identityJwksUrl !== null && !config.identityJwksUrl.startsWith('https://')
        ? 'GATEWAY_IDENTITY_JWKS_URL : https obligatoire en production'
        : null,
  },
];

/**
 * Noms des règles de configuration (intégrées et enregistrées par les lots). Lecture seule, pour la
 * preuve WP25 (`production-refusals.spec.ts`) : chaque règle doit avoir son démarrage réel.
 */
export function productionRuleNames(): string[] {
  return [...BUILT_IN, ...registry].map((rule) => rule.name);
}

/** Temps 1 : règles de configuration. Liste vide hors production (rien n'y est refusé). */
export function evaluateConfigRules(input: GuardInput): string[] {
  if (!input.config.production) return [];
  return [...BUILT_IN, ...registry]
    .map((rule) => rule.check(input))
    .filter((message): message is string => message !== null);
}

/** Réglages du serveur local tels que PostgreSQL les rend, avant tout `SET` de la passerelle. */
export interface ServerSettings {
  fsync: string;
  full_page_writes: string;
  synchronous_commit: string;
  is_superuser: string;
}

export async function readServerSettings(databaseUrl: string): Promise<ServerSettings> {
  const connection = await openBareConnection(databaseUrl);
  try {
    const read = async (name: keyof ServerSettings): Promise<string> => {
      const { rows } = await connection.query<Record<string, string>>(`SHOW ${name}`);
      return String(Object.values(rows[0] ?? {})[0] ?? '');
    };
    return {
      fsync: await read('fsync'),
      full_page_writes: await read('full_page_writes'),
      synchronous_commit: await read('synchronous_commit'),
      is_superuser: await read('is_superuser'),
    };
  } finally {
    await connection.end();
  }
}

/** Temps 2 : réglages du serveur local (production seulement). */
export function evaluateServerRules(config: GatewayConfig, settings: ServerSettings): string[] {
  if (!config.production) return [];
  const violations: string[] = [];
  if (settings.fsync !== 'on')
    violations.push('fsync : désactivé sur la base locale, interdit en production');
  if (settings.full_page_writes !== 'on') {
    violations.push('full_page_writes : désactivé sur la base locale, interdit en production');
  }
  if (settings.synchronous_commit === 'off') {
    violations.push('synchronous_commit : désactivé sur la base locale, interdit en production');
  }
  if (settings.is_superuser === 'on') {
    violations.push(
      'GATEWAY_DATABASE_URL : rôle superutilisateur interdit (rôle edge_app attendu)',
    );
  }
  return violations;
}

/** Contrôle des objets réellement instanciés par Nest (défense en profondeur après `NestFactory.create`). */
export function evaluateProviderRules(
  config: GatewayConfig,
  providers: {
    keystore: { isFake?: boolean };
    catchUp: unknown;
    deltaPurgeProvided: boolean;
  },
): string[] {
  if (!config.production) return [];
  const violations: string[] = [];
  if (providers.keystore.isFake === true) {
    violations.push(
      'HARDWARE_KEYSTORE : le port matériel instancié est un faux, interdit en production',
    );
  }
  // WP18 : le bouchon de rattrapage de WP17 (ou son absence) ne démarre jamais en production.
  if (providers.catchUp === undefined || providers.catchUp === unavailableCatchUp) {
    violations.push('REPLICATION_CATCH_UP : bouchon ou service absent, interdit en production');
  }
  // Le repli `resultOnlyDeltaPurge` (hors WP18) n'est permis que hors production.
  if (!providers.deltaPurgeProvided) {
    violations.push(
      'DELTA_PURGE : règle de purge des deltas absente (repli interdit en production)',
    );
  }
  return violations;
}

export function assertNoViolation(violations: string[]): void {
  if (violations.length > 0) throw new StartupRefusedError(violations);
}
