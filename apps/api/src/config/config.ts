// Configuration lue dans l'environnement (pas de @nestjs/config : aucune dépendance ajoutée).

export interface AppConfig {
  port: number;
  databaseUrl: string;
  poolSize: number;
  /** Rôle `cashless_platform` (contrat platform-access) : écritures de niveau plateforme seulement. */
  platformDatabaseUrl: string;
  platformPoolSize: number;
  problemTypeBase: string;
  production: boolean;
  oidc: OidcConfig;
  /** Rôles de base des processus des clés de bracelet (mission bracelets-nfc) : un pool par processus. */
  tagKeysDatabaseUrl: string;
  personalizationDatabaseUrl: string;
  tagCheckDatabaseUrl: string;
  keyAdminDatabaseUrl: string;
  /** Secret de l'empreinte des codes de rattachement (32 octets au moins), hors de la base. */
  claimCodeHmacKey: Buffer;
  /** Durée de vie en mémoire d'une clé de données en clair, en secondes (0 à 300 ; 0 = aucun cache). */
  tagDekCacheSeconds: number;
  /** Clé d'emballage des clés de données dans le service de clés. */
  tagWrappingKeyRef: string;
  /** Domaine des liens imprimés sur les bracelets (`https://<domaine>/c/<code>`, ADR-56) ; obligatoire en production. */
  claimCodeDomain: string;
  /**
   * Nombre de répartiteurs (proxys) de confiance devant les processus HTTP (`TRUST_PROXY_HOPS`, OP-N53) : Express
   * prend pour adresse du client celle qui se trouve à ce nombre de sauts dans `X-Forwarded-For`, jamais plus loin.
   * 0 : aucun proxy, l'adresse est celle de la connexion. Obligatoire en production, aucun défaut.
   */
  trustProxyHops: number;
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
    if (production)
      throw new Error(
        `${name} manquant : configuration du serveur d'identité obligatoire en production`,
      );
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
  if (production && protocol !== 'https:')
    throw new Error('OIDC_JWKS_URI : https obligatoire en production');
  return {
    issuer: read('OIDC_ISSUER'),
    audience: read('OIDC_AUDIENCE'),
    approvalAudience: read('OIDC_APPROVAL_AUDIENCE'),
    jwksUri,
    clockToleranceSeconds: 10,
  };
}

const LOCAL_DATABASE_URL =
  'postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test';
const LOCAL_PLATFORM_DATABASE_URL =
  'postgres://cashless_platform:cashless_platform_local@127.0.0.1:5433/cashless_test';

const LOCAL_TAG_URLS = {
  DATABASE_URL_TAGKEYS:
    'postgres://cashless_tagkeys:cashless_tagkeys_local@127.0.0.1:5433/cashless_test',
  DATABASE_URL_PERSO: 'postgres://cashless_perso:cashless_perso_local@127.0.0.1:5433/cashless_test',
  DATABASE_URL_TAGCHECK:
    'postgres://cashless_tagcheck:cashless_tagcheck_local@127.0.0.1:5433/cashless_test',
  DATABASE_URL_KEYADMIN:
    'postgres://cashless_keyadmin:cashless_keyadmin_local@127.0.0.1:5433/cashless_test',
} as const;

/** Secret de test, hors production seulement : sa valeur est publique. */
const TEST_CLAIM_CODE_HMAC_KEY = Buffer.from(
  'cashless-claim-code-hmac-key-de-test-uniquement-0000',
  'utf8',
);

/** `CLAIM_CODE_HMAC_KEY` : 32 octets au moins, en hexadécimal ou en base64. Obligatoire en production. */
function claimCodeHmacKey(env: NodeJS.ProcessEnv, production: boolean): Buffer {
  const raw = env.CLAIM_CODE_HMAC_KEY;
  if (!raw) {
    if (production)
      throw new Error(
        'CLAIM_CODE_HMAC_KEY manquant : secret de l’empreinte des codes de rattachement obligatoire en production',
      );
    return TEST_CLAIM_CODE_HMAC_KEY;
  }
  const key =
    /^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
  if (key.length < 32) throw new Error('CLAIM_CODE_HMAC_KEY : 32 octets au moins attendus');
  return key;
}

function tagDekCacheSeconds(value: string | undefined): number {
  if (value === undefined || value === '') return 300;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 300) {
    throw new Error(`TAG_DEK_CACHE_SECONDS : entier de 0 à 300 attendu (reçu « ${value} »)`);
  }
  return parsed;
}

/** Nom de domaine seul (ni schéma, ni chemin) : il est imprimé tel quel dans le QR de chaque bracelet. */
function claimCodeDomain(value: string | undefined, production: boolean): string {
  if (value === undefined || value === '') return production ? '' : 'pay.cashless.test';
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)) {
    throw new Error(`CLAIM_CODE_DOMAIN : nom de domaine attendu (reçu « ${value} »)`);
  }
  return value.toLowerCase();
}

/** Plus grand nombre de sauts admis : au-delà, c'est une erreur de configuration, pas un déploiement réel. */
export const MAX_TRUST_PROXY_HOPS = 5;

/**
 * `TRUST_PROXY_HOPS` : entier de 0 à 5. En production, absent ou vide = refus de démarrer (pas de défaut permissif :
 * une valeur trop haute rendrait `X-Forwarded-For` falsifiable, une valeur trop basse confondrait tous les clients
 * avec le répartiteur). Hors production : 0 par défaut (adresse de la connexion, `X-Forwarded-For` ignoré).
 */
function trustProxyHops(value: string | undefined, production: boolean): number {
  if (value === undefined || value === '') {
    if (production) {
      throw new Error(
        'TRUST_PROXY_HOPS manquant : nombre de répartiteurs de confiance devant l’API obligatoire en production (0 sans répartiteur)',
      );
    }
    return 0;
  }
  if (!/^[0-9]+$/.test(value) || Number(value) > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS : entier de 0 à ${MAX_TRUST_PROXY_HOPS} attendu (reçu « ${value} »)`,
    );
  }
  return Number(value);
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} : entier positif attendu (reçu « ${value} »)`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL_APP;
  if (!databaseUrl && production) {
    throw new Error(
      'DATABASE_URL_APP manquant : chaîne de connexion du rôle cashless_app obligatoire en production',
    );
  }
  const platformDatabaseUrl = env.DATABASE_URL_PLATFORM;
  if (!platformDatabaseUrl && production) {
    throw new Error(
      'DATABASE_URL_PLATFORM manquant : chaîne de connexion du rôle cashless_platform obligatoire en production',
    );
  }
  // En production, l'absence d'une de ces chaînes n'empêche pas les autres processus de démarrer : c'est le processus
  // qui s'en sert qui la refuse vide (voir processes/).
  const tagUrl = (name: keyof typeof LOCAL_TAG_URLS): string =>
    env[name] || (production ? '' : LOCAL_TAG_URLS[name]);
  const base = env.PROBLEM_TYPE_BASE || 'https://errors.cashless/';
  return {
    port: positiveInt('PORT', env.PORT, 3000),
    databaseUrl: databaseUrl || LOCAL_DATABASE_URL,
    poolSize: positiveInt('DB_POOL_SIZE', env.DB_POOL_SIZE, 10),
    platformDatabaseUrl: platformDatabaseUrl || LOCAL_PLATFORM_DATABASE_URL,
    platformPoolSize: positiveInt('DB_PLATFORM_POOL_SIZE', env.DB_PLATFORM_POOL_SIZE, 2),
    problemTypeBase: base.endsWith('/') ? base : `${base}/`,
    production,
    oidc: loadOidc(env, production),
    tagKeysDatabaseUrl: tagUrl('DATABASE_URL_TAGKEYS'),
    personalizationDatabaseUrl: tagUrl('DATABASE_URL_PERSO'),
    tagCheckDatabaseUrl: tagUrl('DATABASE_URL_TAGCHECK'),
    keyAdminDatabaseUrl: tagUrl('DATABASE_URL_KEYADMIN'),
    claimCodeHmacKey: claimCodeHmacKey(env, production),
    tagDekCacheSeconds: tagDekCacheSeconds(env.TAG_DEK_CACHE_SECONDS),
    tagWrappingKeyRef: env.TAG_WRAPPING_KEY_REF || (production ? '' : 'fake-kms:wrap:test'),
    claimCodeDomain: claimCodeDomain(env.CLAIM_CODE_DOMAIN, production),
    trustProxyHops: trustProxyHops(env.TRUST_PROXY_HOPS, production),
  };
}

/** Préfixe global des routes (contrat : /v1). */
export const API_PREFIX = 'v1';

/** Jeton d'injection de la configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
