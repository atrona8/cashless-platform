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
  /** Clé d'emballage des clés de données dans le service de clés ; obligatoire en production. */
  tagWrappingKeyRef: string;
  /** Domaine des liens imprimés sur les bracelets (`https://<domaine>/c/<code>`, ADR-56) ; obligatoire en production. */
  claimCodeDomain: string;
  /**
   * Nombre de répartiteurs (proxys) de confiance devant les processus HTTP (`TRUST_PROXY_HOPS`, OP-N53) : Express
   * prend pour adresse du client celle qui se trouve à ce nombre de sauts dans `X-Forwarded-For`, jamais plus loin.
   * 0 : aucun proxy, l'adresse est celle de la connexion. Obligatoire en production, aucun défaut.
   */
  trustProxyHops: number;

  // ----- Mission identite-enrolement-terminaux (research R-03, R-07, R-09, R-13) -----
  /**
   * Certificat et clé du serveur HTTPS des processus (`TLS_CERT_FILE`, `TLS_KEY_FILE`, R-03). Obligatoires en
   * production ; hors production, absents tous deux = écoute en clair (tests d'intégration existants).
   */
  tlsCertFile: string | null;
  tlsKeyFile: string | null;
  /**
   * Autorité des terminaux (`DEVICE_CA_CERT_FILE`, PEM) : seule autorité cliente du mTLS (`ca`). Obligatoire en
   * production, et partout dès que TLS est configuré (sans elle, Node jugerait les certificats clients contre les
   * autorités publiques).
   */
  deviceCaCertFile: string | null;
  /**
   * Clé de l'autorité DE TEST des terminaux (`DEVICE_CA_FAKE_KEY_FILE`), lue seulement par le faux de l'autorité.
   * Présente en production : refus de démarrer.
   */
  deviceCaFakeKeyFile: string | null;
  /** Émetteur (`iss`) des jetons d'appareil (`DEVICE_TOKEN_ISSUER`, contracts/device-tokens.md). */
  deviceTokenIssuer: string;
  /**
   * Durée du jeton d'appareil en secondes (`DEVICE_TOKEN_TTL_SECONDS`, R-07) : 60 à 900 en
   * production (15 min au plus, spécification et contrat ; DRIFT-2 de la revue post-fusion), 60 à
   * 3600 ailleurs ; 900 en test.
   */
  deviceTokenTtlSeconds: number;
  /** Durée du jeton de rafraîchissement en jours (`DEVICE_REFRESH_TOKEN_TTL_DAYS`, 1 à 90 ; 30 en test, R-07). */
  deviceRefreshTokenTtlDays: number;
  /** Durée du certificat client en jours (`DEVICE_CERT_VALIDITY_DAYS`, 1 à 730 ; 365 en test, R-09). */
  deviceCertValidityDays: number;
  /** Racines Google de l'attestation Android (`ANDROID_ATTESTATION_ROOTS`, fichier PEM, R-05). */
  androidAttestationRoots: string | null;
  /** Paquet de l'application terminal Android (`ANDROID_APP_PACKAGE`). */
  androidAppPackage: string;
  /**
   * Empreintes SHA-256 autorisées du certificat de signature de l'application (`ANDROID_APP_SIGNING_DIGESTS`, liste
   * séparée par des virgules, hexadécimal ; les `:` de `keytool` sont admis). Rendues en hexadécimal minuscule.
   */
  androidAppSigningDigests: string[];
  /** Niveau de correctif minimal, `AAAAMM` (`ANDROID_MIN_PATCH_LEVEL`, R-05). */
  androidMinPatchLevel: number;
  /** Racine Apple App Attestation (`IOS_APP_ATTEST_ROOT`, fichier PEM, R-06). */
  iosAppAttestRoot: string | null;
  /** Identifiant d'équipe Apple (`IOS_TEAM_ID`, 10 caractères). */
  iosTeamId: string;
  /** Identifiant de l'application iOS (`IOS_BUNDLE_ID`). */
  iosBundleId: string;
  /** Environnement App Attest (`IOS_APP_ATTEST_ENVIRONMENT`) : `production` exigé en production (R-06). */
  iosAppAttestEnvironment: IosAppAttestEnvironment;
  /** Secret de l'empreinte des requêtes idempotentes (`IDEMPOTENCY_HMAC_KEY`, 32 octets au moins, R-13). */
  idempotencyHmacKey: Buffer;
  /** Secret de l'empreinte des codes d'enrôlement (`ENROLLMENT_CODE_HMAC_KEY`, 32 octets au moins, R-13). */
  enrollmentCodeHmacKey: Buffer;
  /**
   * Tolérance d'horloge par défaut des terminaux (`CLOCK_TOLERANCE_SECONDS`, 0 à 300 ; 120 en test, défaut du
   * contrat) : la valeur de la configuration de l'événement, lue à l'exécution, prime.
   */
  clockToleranceSeconds: number;
  /**
   * Autorités (`host[:port]`) auxquelles un terminal peut adresser une requête signée
   * (`DEVICE_REQUEST_AUTHORITIES`, liste séparée par des virgules ; research R-04, lot WP12) :
   * `@authority` est signé, et une requête signée pour une autre autorité (la passerelle locale, un
   * autre déploiement) est refusée. Obligatoire en production ; `host:*` (tout port) hors
   * production seulement.
   */
  deviceRequestAuthorities: string[];
}

export const IOS_APP_ATTEST_ENVIRONMENTS = ['production', 'development'] as const;
export type IosAppAttestEnvironment = (typeof IOS_APP_ATTEST_ENVIRONMENTS)[number];

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

/** Secrets de test, hors production seulement : leurs valeurs sont publiques. */
const TEST_IDEMPOTENCY_HMAC_KEY = Buffer.from(
  'cashless-idempotency-hmac-key-de-test-uniquement-00',
  'utf8',
);
const TEST_ENROLLMENT_CODE_HMAC_KEY = Buffer.from(
  'cashless-enrollment-code-hmac-key-de-test-uniquement',
  'utf8',
);

/** Les secrets de test : refusés en production même posés explicitement (ex. `env.sh` sourcé par erreur). */
const TEST_HMAC_KEYS = [
  TEST_CLAIM_CODE_HMAC_KEY,
  TEST_IDEMPOTENCY_HMAC_KEY,
  TEST_ENROLLMENT_CODE_HMAC_KEY,
];

/**
 * Secret HMAC lu dans `name` : 32 octets au moins, en hexadécimal ou en base64. Obligatoire en production, où les
 * secrets de test sont refusés ; hors production, `testKey` par défaut.
 */
function hmacKey(
  env: NodeJS.ProcessEnv,
  name: string,
  purpose: string,
  production: boolean,
  testKey: Buffer,
): Buffer {
  const raw = env[name];
  if (!raw) {
    if (production)
      throw new Error(`${name} manquant : secret ${purpose} obligatoire en production`);
    return testKey;
  }
  const key =
    /^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
  if (key.length < 32) throw new Error(`${name} : 32 octets au moins attendus`);
  if (production && TEST_HMAC_KEYS.some((test) => test.equals(key)))
    throw new Error(`${name} : secret de test refusé en production`);
  return key;
}

/** `CLAIM_CODE_HMAC_KEY` : 32 octets au moins, en hexadécimal ou en base64. Obligatoire en production. */
function claimCodeHmacKey(env: NodeJS.ProcessEnv, production: boolean): Buffer {
  return hmacKey(
    env,
    'CLAIM_CODE_HMAC_KEY',
    'de l’empreinte des codes de rattachement',
    production,
    TEST_CLAIM_CODE_HMAC_KEY,
  );
}

function tagDekCacheSeconds(value: string | undefined): number {
  if (value === undefined || value === '') return 300;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 300) {
    throw new Error(`TAG_DEK_CACHE_SECONDS : entier de 0 à 300 attendu (reçu « ${value} »)`);
  }
  return parsed;
}

/**
 * Nom de domaine seul (ni schéma, ni chemin) : il est imprimé tel quel dans le QR de chaque
 * bracelet. Obligatoire en production dès le chargement (RISK-4) : il n'était refusé qu'à la
 * première génération de codes.
 */
function claimCodeDomain(value: string | undefined, production: boolean): string {
  if (value === undefined || value === '') {
    if (production) {
      throw new Error(
        'CLAIM_CODE_DOMAIN manquant : domaine des liens imprimés sur les bracelets, ' +
          'obligatoire en production',
      );
    }
    return 'pay.cashless.test';
  }
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

/**
 * Valeurs admises de `NODE_ENV` (RISK-3 de la revue post-fusion de bracelets-nfc). `production`
 * arme toutes les gardes (aucun faux, secrets et références obligatoires) ; `development` (poste
 * local) et `test` (Jest, CI) les laissent désarmées. Toute autre valeur, ou son absence, refuse le
 * démarrage : un déploiement oublié ou mal nommé (`prod`, `staging`) démarrait sinon hors
 * production, avec les faux et le secret de test.
 */
export const NODE_ENVS = ['production', 'development', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

function nodeEnv(value: string | undefined): NodeEnv {
  if (!NODE_ENVS.includes(value as NodeEnv)) {
    throw new Error(
      `NODE_ENV ${value ? `inconnu (« ${value} »)` : 'manquant'} : ${NODE_ENVS.join(', ')} attendu`,
    );
  }
  return value as NodeEnv;
}

/**
 * Référence de la clé d'emballage des clés de données (RISK-4) : obligatoire en production, défaut
 * de test ailleurs.
 */
function tagWrappingKeyRef(value: string | undefined, production: boolean): string {
  if (value) return value;
  if (production) {
    throw new Error(
      'TAG_WRAPPING_KEY_REF manquant : clé d’emballage des clés de données, ' +
        'obligatoire en production',
    );
  }
  return 'fake-kms:wrap:test';
}

// ----- Mission identite-enrolement-terminaux -----

/** Valeurs hors production (tests, poste local) des réglages des terminaux ; publiques, jamais servies en production. */
const TEST_DEVICE_SETTINGS = {
  DEVICE_TOKEN_ISSUER: 'https://api.cashless.test',
  ANDROID_APP_PACKAGE: 'org.cashless.terminal',
  // SHA-256 de « cashless-terminal-test-signing » : empreinte du certificat de signature de l'app de test.
  ANDROID_APP_SIGNING_DIGESTS: '7d51f416c76adade6809a73c4308b8fec0b742b2a6d3011edab8dda18d17ffb6',
  IOS_TEAM_ID: 'TESTTEAM01',
  IOS_BUNDLE_ID: 'org.cashless.terminal',
  // Serveurs HTTPS de test : `localhost` et 127.0.0.1, sur un port tiré à chaque test.
  DEVICE_REQUEST_AUTHORITIES: 'localhost:*,127.0.0.1:*',
} as const;

/** Réglage texte : obligatoire en production, valeur de test ailleurs. */
function required(
  env: NodeJS.ProcessEnv,
  name: keyof typeof TEST_DEVICE_SETTINGS,
  purpose: string,
  production: boolean,
): string {
  const value = env[name];
  if (value) return value;
  if (production) throw new Error(`${name} manquant : ${purpose} obligatoire en production`);
  return TEST_DEVICE_SETTINGS[name];
}

/** Chemin de fichier : obligatoire en production, absent (`null`) ailleurs s'il n'est pas posé. */
function filePath(
  env: NodeJS.ProcessEnv,
  name: string,
  purpose: string,
  production: boolean,
): string | null {
  const value = env[name];
  if (value) return value;
  if (production) throw new Error(`${name} manquant : ${purpose} obligatoire en production`);
  return null;
}

/**
 * Durée maximale du jeton d'appareil en production, en secondes : 15 min (spécification, contrat ;
 * DRIFT-2 de la revue post-fusion de la mission 5a). Au-delà, refus de démarrer.
 */
export const DEVICE_TOKEN_TTL_MAX_PRODUCTION = 900;

/** Entier borné : obligatoire en production, `testValue` ailleurs. */
function boundedInt(
  env: NodeJS.ProcessEnv,
  name: string,
  bounds: { min: number; max: number; test: number },
  production: boolean,
): number {
  const value = env[name];
  if (value === undefined || value === '') {
    if (production)
      throw new Error(
        `${name} manquant : entier de ${bounds.min} à ${bounds.max} obligatoire en production`,
      );
    return bounds.test;
  }
  if (!/^[0-9]+$/.test(value) || Number(value) < bounds.min || Number(value) > bounds.max)
    throw new Error(
      `${name} : entier de ${bounds.min} à ${bounds.max} attendu (reçu « ${value} »)`,
    );
  return Number(value);
}

/**
 * Transport HTTPS (R-03) : certificat et clé du serveur ensemble ou pas du tout ; l'autorité des terminaux dès que
 * TLS est configuré ; la clé de l'autorité de test jamais en production.
 */
function tlsSettings(
  env: NodeJS.ProcessEnv,
  production: boolean,
): Pick<AppConfig, 'tlsCertFile' | 'tlsKeyFile' | 'deviceCaCertFile' | 'deviceCaFakeKeyFile'> {
  const tlsCertFile = filePath(env, 'TLS_CERT_FILE', 'certificat du serveur HTTPS', production);
  const tlsKeyFile = filePath(env, 'TLS_KEY_FILE', 'clé du serveur HTTPS', production);
  if ((tlsCertFile === null) !== (tlsKeyFile === null))
    throw new Error('TLS_CERT_FILE et TLS_KEY_FILE : les deux ou aucun');
  const deviceCaCertFile = filePath(
    env,
    'DEVICE_CA_CERT_FILE',
    'autorité des terminaux (mTLS)',
    production,
  );
  if (tlsCertFile !== null && deviceCaCertFile === null)
    throw new Error(
      'DEVICE_CA_CERT_FILE manquant : autorité des terminaux obligatoire dès que TLS est configuré',
    );
  const deviceCaFakeKeyFile = env.DEVICE_CA_FAKE_KEY_FILE || null;
  if (production && deviceCaFakeKeyFile !== null)
    throw new Error(
      'DEVICE_CA_FAKE_KEY_FILE posé : clé de l’autorité de test des terminaux interdite en production',
    );
  return { tlsCertFile, tlsKeyFile, deviceCaCertFile, deviceCaFakeKeyFile };
}

/** Empreintes SHA-256 (64 caractères hexadécimaux, `:` admis), au moins une ; rendues en minuscules, sans doublon. */
function signingDigests(raw: string): string[] {
  const digests = raw.split(',').map((digest) => digest.trim().replace(/:/g, '').toLowerCase());
  if (digests.length === 0 || digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest)))
    throw new Error(
      'ANDROID_APP_SIGNING_DIGESTS : liste d’empreintes SHA-256 en hexadécimal attendue, séparées par des virgules',
    );
  return [...new Set(digests)];
}

/** `AAAAMM` (année 2017 et après, mois 01 à 12), comme `osPatchLevel` de KeyDescription. */
function patchLevel(env: NodeJS.ProcessEnv, production: boolean): number {
  const value = env.ANDROID_MIN_PATCH_LEVEL;
  if (value === undefined || value === '') {
    if (production)
      throw new Error(
        'ANDROID_MIN_PATCH_LEVEL manquant : niveau de correctif minimal (AAAAMM) obligatoire en production',
      );
    return 202201;
  }
  const match = /^(20[1-9][0-9])(0[1-9]|1[0-2])$/.exec(value);
  if (!match || Number(match[1]) < 2017)
    throw new Error(`ANDROID_MIN_PATCH_LEVEL : AAAAMM attendu (reçu « ${value} »)`);
  return Number(value);
}

function attestationSettings(
  env: NodeJS.ProcessEnv,
  production: boolean,
): Pick<
  AppConfig,
  | 'androidAttestationRoots'
  | 'androidAppPackage'
  | 'androidAppSigningDigests'
  | 'androidMinPatchLevel'
  | 'iosAppAttestRoot'
  | 'iosTeamId'
  | 'iosBundleId'
  | 'iosAppAttestEnvironment'
> {
  const androidAppPackage = required(
    env,
    'ANDROID_APP_PACKAGE',
    'paquet de l’application terminal Android',
    production,
  );
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(androidAppPackage))
    throw new Error(`ANDROID_APP_PACKAGE : nom de paquet attendu (reçu « ${androidAppPackage} »)`);
  const iosTeamId = required(env, 'IOS_TEAM_ID', 'identifiant d’équipe Apple', production);
  if (!/^[A-Z0-9]{10}$/.test(iosTeamId))
    throw new Error(`IOS_TEAM_ID : 10 caractères A-Z ou 0-9 attendus (reçu « ${iosTeamId} »)`);
  const iosBundleId = required(
    env,
    'IOS_BUNDLE_ID',
    'identifiant de l’application iOS',
    production,
  );
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(iosBundleId))
    throw new Error(`IOS_BUNDLE_ID : identifiant d’application attendu (reçu « ${iosBundleId} »)`);
  return {
    androidAttestationRoots: filePath(
      env,
      'ANDROID_ATTESTATION_ROOTS',
      'racines Google de l’attestation Android',
      production,
    ),
    androidAppPackage,
    androidAppSigningDigests: signingDigests(
      required(
        env,
        'ANDROID_APP_SIGNING_DIGESTS',
        'empreintes de signature de l’application Android',
        production,
      ),
    ),
    androidMinPatchLevel: patchLevel(env, production),
    iosAppAttestRoot: filePath(
      env,
      'IOS_APP_ATTEST_ROOT',
      'racine Apple App Attestation',
      production,
    ),
    iosTeamId,
    iosBundleId,
    iosAppAttestEnvironment: iosAppAttestEnvironment(env.IOS_APP_ATTEST_ENVIRONMENT, production),
  };
}

/**
 * `IOS_APP_ATTEST_ENVIRONMENT` : `production` ou `development`. En production, seul `production` est admis (une
 * attestation `appattestdevelop` vient d'une app signée pour le développement, R-06) ; `development` hors production.
 */
function iosAppAttestEnvironment(
  value: string | undefined,
  production: boolean,
): IosAppAttestEnvironment {
  if (value === undefined || value === '') {
    if (production)
      throw new Error(
        'IOS_APP_ATTEST_ENVIRONMENT manquant : environnement App Attest obligatoire en production',
      );
    return 'development';
  }
  if (!IOS_APP_ATTEST_ENVIRONMENTS.includes(value as IosAppAttestEnvironment))
    throw new Error(
      `IOS_APP_ATTEST_ENVIRONMENT : ${IOS_APP_ATTEST_ENVIRONMENTS.join(' ou ')} attendu (reçu « ${value} »)`,
    );
  if (production && value !== 'production')
    throw new Error('IOS_APP_ATTEST_ENVIRONMENT : « production » exigé en production');
  return value as IosAppAttestEnvironment;
}

/** Les trois secrets HMAC sont distincts deux à deux : un secret partagé lierait des empreintes sans rapport. */
function assertDistinctHmacKeys(keys: Record<string, Buffer>): void {
  const entries = Object.entries(keys);
  for (let i = 0; i < entries.length; i += 1)
    for (let j = i + 1; j < entries.length; j += 1)
      if (entries[i]![1].equals(entries[j]![1]))
        throw new Error(`${entries[i]![0]} et ${entries[j]![0]} : secrets distincts attendus`);
}

/** Réglages ajoutés par la mission des terminaux. */
type DeviceSettings = Pick<
  AppConfig,
  | 'tlsCertFile'
  | 'tlsKeyFile'
  | 'deviceCaCertFile'
  | 'deviceCaFakeKeyFile'
  | 'deviceTokenIssuer'
  | 'deviceTokenTtlSeconds'
  | 'deviceRefreshTokenTtlDays'
  | 'deviceCertValidityDays'
  | 'androidAttestationRoots'
  | 'androidAppPackage'
  | 'androidAppSigningDigests'
  | 'androidMinPatchLevel'
  | 'iosAppAttestRoot'
  | 'iosTeamId'
  | 'iosBundleId'
  | 'iosAppAttestEnvironment'
  | 'idempotencyHmacKey'
  | 'enrollmentCodeHmacKey'
  | 'clockToleranceSeconds'
  | 'deviceRequestAuthorities'
>;

function deviceSettings(
  env: NodeJS.ProcessEnv,
  production: boolean,
  claimKey: Buffer,
): DeviceSettings {
  const idempotencyHmacKey = hmacKey(
    env,
    'IDEMPOTENCY_HMAC_KEY',
    'de l’empreinte des requêtes idempotentes',
    production,
    TEST_IDEMPOTENCY_HMAC_KEY,
  );
  const enrollmentCodeHmacKey = hmacKey(
    env,
    'ENROLLMENT_CODE_HMAC_KEY',
    'de l’empreinte des codes d’enrôlement',
    production,
    TEST_ENROLLMENT_CODE_HMAC_KEY,
  );
  assertDistinctHmacKeys({
    CLAIM_CODE_HMAC_KEY: claimKey,
    IDEMPOTENCY_HMAC_KEY: idempotencyHmacKey,
    ENROLLMENT_CODE_HMAC_KEY: enrollmentCodeHmacKey,
  });
  const deviceTokenIssuer = required(
    env,
    'DEVICE_TOKEN_ISSUER',
    'émetteur des jetons d’appareil',
    production,
  );
  if (/\s/.test(deviceTokenIssuer)) throw new Error('DEVICE_TOKEN_ISSUER : aucun espace attendu');
  return {
    ...tlsSettings(env, production),
    deviceTokenIssuer,
    deviceTokenTtlSeconds: boundedInt(
      env,
      'DEVICE_TOKEN_TTL_SECONDS',
      { min: 60, max: production ? DEVICE_TOKEN_TTL_MAX_PRODUCTION : 3600, test: 900 },
      production,
    ),
    deviceRefreshTokenTtlDays: boundedInt(
      env,
      'DEVICE_REFRESH_TOKEN_TTL_DAYS',
      { min: 1, max: 90, test: 30 },
      production,
    ),
    deviceCertValidityDays: boundedInt(
      env,
      'DEVICE_CERT_VALIDITY_DAYS',
      { min: 1, max: 730, test: 365 },
      production,
    ),
    ...attestationSettings(env, production),
    idempotencyHmacKey,
    enrollmentCodeHmacKey,
    clockToleranceSeconds: boundedInt(
      env,
      'CLOCK_TOLERANCE_SECONDS',
      { min: 0, max: 300, test: 120 },
      production,
    ),
    deviceRequestAuthorities: requestAuthorities(
      required(env, 'DEVICE_REQUEST_AUTHORITIES', 'autorités des requêtes de terminal', production),
      production,
    ),
  };
}

/**
 * `DEVICE_REQUEST_AUTHORITIES` : `host` ou `host:port`, en minuscules, port 443 retiré (forme de
 * `@authority`, R-04). `host:*` (tout port) refusé en production.
 */
function requestAuthorities(raw: string, production: boolean): string[] {
  const entries = raw.split(',').map((entry) => entry.trim().toLowerCase());
  for (const entry of entries) {
    if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:([0-9]{1,5}|\*))?$/.test(entry))
      throw new Error(`DEVICE_REQUEST_AUTHORITIES : autorité invalide (reçu « ${entry} »)`);
    if (production && entry.endsWith(':*'))
      throw new Error('DEVICE_REQUEST_AUTHORITIES : port joker (« :* ») refusé en production');
  }
  return entries.map((entry) => (entry.endsWith(':443') ? entry.slice(0, -4) : entry));
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} : entier positif attendu (reçu « ${value} »)`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = nodeEnv(env.NODE_ENV) === 'production';
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
  const claimKey = claimCodeHmacKey(env, production);
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
    claimCodeHmacKey: claimKey,
    tagDekCacheSeconds: tagDekCacheSeconds(env.TAG_DEK_CACHE_SECONDS),
    tagWrappingKeyRef: tagWrappingKeyRef(env.TAG_WRAPPING_KEY_REF, production),
    claimCodeDomain: claimCodeDomain(env.CLAIM_CODE_DOMAIN, production),
    trustProxyHops: trustProxyHops(env.TRUST_PROXY_HOPS, production),
    ...deviceSettings(env, production, claimKey),
  };
}

/** Préfixe global des routes (contrat : /v1). */
export const API_PREFIX = 'v1';

/** Jeton d'injection de la configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
