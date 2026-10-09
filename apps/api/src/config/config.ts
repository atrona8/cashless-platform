// Configuration lue dans l'environnement (pas de @nestjs/config : aucune dépendance ajoutée).

export interface AppConfig {
  port: number;
  databaseUrl: string;
  poolSize: number;
  problemTypeBase: string;
  production: boolean;
  oidc: OidcConfig;
}

/** Serveur d'identité (contracts/identity.md, research R-01) : les quatre valeurs sont obligatoires en production. */
export interface OidcConfig {
  issuer: string;
  audience: string;
  /** Audience des jetons d'approbation sur place (R-09), distincte de celle des jetons d'accès. */
  approvalAudience: string;
  jwksUri: string;
  clockToleranceSeconds: number;
}

/** Valeurs hors production (tests, poste local) : émetteur du faux serveur d'identité. */
const TEST_OIDC = {
  OIDC_ISSUER: 'https://idp.test',
  OIDC_AUDIENCE: 'cashless-api',
  OIDC_APPROVAL_AUDIENCE: 'cashless-approval',
  OIDC_JWKS_URI: 'https://idp.test/.well-known/jwks.json',
} as const;

function loadOidc(env: NodeJS.ProcessEnv, production: boolean): OidcConfig {
  const read = (name: keyof typeof TEST_OIDC): string => {
    const value = env[name];
    if (value) return value;
    if (production) throw new Error(`${name} manquant : configuration du serveur d'identité obligatoire en production`);
    return TEST_OIDC[name];
  };
  const jwksUri = read('OIDC_JWKS_URI');
  let protocol: string;
  try {
    protocol = new URL(jwksUri).protocol;
  } catch {
    throw new Error(`OIDC_JWKS_URI : URL invalide (reçu « ${jwksUri} »)`);
  }
  // Une JWKS servie en clair permettrait de substituer les clés (R-11 A2).
  if (production && protocol !== 'https:') throw new Error('OIDC_JWKS_URI : https obligatoire en production');
  return {
    issuer: read('OIDC_ISSUER'),
    audience: read('OIDC_AUDIENCE'),
    approvalAudience: read('OIDC_APPROVAL_AUDIENCE'),
    jwksUri,
    clockToleranceSeconds: 10,
  };
}

const LOCAL_DATABASE_URL = 'postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test';

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} : entier positif attendu (reçu « ${value} »)`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL_APP;
  if (!databaseUrl && production) {
    throw new Error('DATABASE_URL_APP manquant : chaîne de connexion du rôle cashless_app obligatoire en production');
  }
  const base = env.PROBLEM_TYPE_BASE || 'https://errors.cashless/';
  return {
    port: positiveInt('PORT', env.PORT, 3000),
    databaseUrl: databaseUrl || LOCAL_DATABASE_URL,
    poolSize: positiveInt('DB_POOL_SIZE', env.DB_POOL_SIZE, 10),
    problemTypeBase: base.endsWith('/') ? base : `${base}/`,
    production,
    oidc: loadOidc(env, production),
  };
}

/** Préfixe global des routes (contrat : /v1). */
export const API_PREFIX = 'v1';

/** Jeton d'injection de la configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
