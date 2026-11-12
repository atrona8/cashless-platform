// Configuration de la passerelle (interfaces.md § 8 et § 12.9), à échec fermé : aucun secret par
// défaut, aucune clé
// inconnue, `NODE_ENV` par `nodeEnv()` de `@cashless/shared-rules` (absent, `prod`, `staging`,
// `Production` refusent).
//
// Ce fichier lit et type les réglages ; il ne juge PAS les valeurs interdites en production (faux,
// joker, absence de
// TLS, points d'arrêt...) : c'est `processes/startup-guard.ts` qui les refuse TOUTES d'un coup,
// avec la liste complète.
// Une variable vide vaut absente. Un message d'erreur nomme la variable, jamais sa valeur.
import { nodeEnv, type NodeEnv } from '@cashless/shared-rules';
import { clientKeyFileViolations } from './client-key-file';

/**
 * Toutes les variables lues. Toute autre variable `GATEWAY_*` est une faute de frappe : le
 * démarrage est refusé.
 */
export const KNOWN_KEYS = [
  'NODE_ENV',
  'GATEWAY_DATABASE_URL',
  'GATEWAY_CENTRAL_URL',
  'GATEWAY_LISTEN_PORT',
  'GATEWAY_TLS_CERT_FILE',
  'GATEWAY_TLS_KEY_FILE',
  'GATEWAY_DEVICE_CA_FILE',
  'GATEWAY_CENTRAL_CLIENT_CERT_FILE',
  'GATEWAY_CENTRAL_CLIENT_KEY_FILE',
  'GATEWAY_REQUEST_AUTHORITY',
  'GATEWAY_ENROLLMENT_FILE',
  'HARDWARE_KEYSTORE',
  'EDGE_FAILPOINT',
  'EDGE_ALLOW_FAILPOINTS',
  // Ajoutées par interfaces.md § 12.9 et § 13.3 (développement seulement, sauf JWKS et port
  // d'administration).
  'GATEWAY_IDENTITY_JWKS_URL',
  'GATEWAY_IDENTITY_VERIFIER',
  // WP22 : émetteur et audience attendus des jetons de personne au guichet (échec fermé si absents).
  'GATEWAY_IDENTITY_ISSUER',
  'GATEWAY_IDENTITY_AUDIENCE',
  'GATEWAY_ADMIN_PORT',
  'EDGE_CA',
  // Fichier de clés du faux du port matériel (développement et test seulement, refusé en production).
  'GATEWAY_DEV_KEY_FILE',
  // WP24 : marqueur de purge hors base (volume de la passerelle) ; défaut `./purge.marker`.
  'GATEWAY_PURGE_MARKER_FILE',
  // WP24 (décision 47) : certificat et clé TLS DU PORT D'ADMINISTRATION (distincts de ceux des
  // terminaux).
  'GATEWAY_ADMIN_TLS_CERT_FILE',
  'GATEWAY_ADMIN_TLS_KEY_FILE',
] as const;

export type HardwareKeystoreKind = 'fake' | 'hardware';

export interface GatewayConfig {
  nodeEnv: NodeEnv;
  production: boolean;
  databaseUrl: string;
  centralUrl: string | null;
  listenPort: number;
  tlsCertFile: string | null;
  tlsKeyFile: string | null;
  deviceCaFile: string | null;
  centralClientCertFile: string | null;
  centralClientKeyFile: string | null;
  /**
   * Valeur brute de `GATEWAY_REQUEST_AUTHORITY` : `hôte:port` d'une seule adresse (jugée par la
   * garde).
   */
  requestAuthority: string | null;
  enrollmentFile: string | null;
  hardwareKeystore: HardwareKeystoreKind;
  failpoint: string | null;
  allowFailpoints: string | null;
  identityJwksUrl: string | null;
  /** `test` : faux vérificateur d'identité, hors production seulement. */
  identityVerifier: string | null;
  /**
   * `iss` attendu des jetons de personne (WP22) ; absent : aucun jeton de personne n'est accepté.
   */
  identityIssuer: string | null;
  /**
   * `aud` attendu des jetons de personne (WP22) ; absent : aucun jeton de personne n'est accepté.
   */
  identityAudience: string | null;
  /** Port de l'écouteur d'administration local (boucle locale seule, WP17). */
  adminPort: number;
  /** `fake` : faux de l'autorité de certification, hors production seulement. */
  edgeCa: string | null;
  /** Fichier (mode 0600, hors dépôt) où le FAUX garde ses clés entre deux processus. */
  devKeyFile: string | null;
  /**
   * Marqueur de purge (WP24), sur le volume de la passerelle ; absent : `purge.marker` du dossier
   * courant.
   */
  purgeMarkerFile: string | null;
  /** TLS du port d'administration (décision 47) ; exigé en production (`purge/admin-tls.ts`). */
  adminTlsCertFile: string | null;
  adminTlsKeyFile: string | null;
}

export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const text = (env: Env, name: string): string | null => {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
};

function mandatory(env: Env, name: string, production: boolean, purpose: string): string | null {
  const value = text(env, name);
  if (value === null && production) {
    throw new ConfigError(`${name} manquant : ${purpose} obligatoire en production`);
  }
  return value;
}

/**
 * Entier de 1 à 65535 ; 0 (port éphémère) n'est permis que hors production, pour les suites de
 * tests.
 */
function port(env: Env, name: string, production: boolean, fallback: number | null): number {
  const raw = text(env, name);
  if (raw === null) {
    if (fallback === null) throw new ConfigError(`${name} manquant : port obligatoire`);
    if (production) throw new ConfigError(`${name} manquant : port obligatoire en production`);
    return fallback;
  }
  const value = /^[0-9]{1,5}$/.test(raw) ? Number(raw) : -1;
  const min = production ? 1 : 0;
  if (value < min || value > 65535) {
    throw new ConfigError(`${name} : entier de ${min} à 65535 attendu`);
  }
  return value;
}

function pair(env: Env, a: string, b: string, production: boolean): [string | null, string | null] {
  const first = text(env, a);
  const second = text(env, b);
  if ((first === null) !== (second === null)) {
    throw new ConfigError(`${first === null ? a : b} manquant : ${a} et ${b} vont ensemble`);
  }
  if (production && first === null) {
    throw new ConfigError(`${a} et ${b} manquants : obligatoires en production`);
  }
  return [first, second];
}

/**
 * `GATEWAY_*` inconnues : une faute de frappe sur un réglage de sécurité ne doit pas passer en
 * silence.
 */
function assertNoUnknownKey(env: Env): void {
  const known = new Set<string>(KNOWN_KEYS);
  const unknown = Object.keys(env).filter((key) => key.startsWith('GATEWAY_') && !known.has(key));
  if (unknown.length > 0) {
    throw new ConfigError(`variable inconnue : ${unknown.sort().join(', ')}`);
  }
}

export function loadConfig(env: Env = process.env): GatewayConfig {
  const resolved = nodeEnv(env.NODE_ENV);
  const production = resolved === 'production';
  assertNoUnknownKey(env);

  const databaseUrl = text(env, 'GATEWAY_DATABASE_URL');
  if (databaseUrl === null) {
    throw new ConfigError(
      'GATEWAY_DATABASE_URL manquant : base locale (rôle edge_app) obligatoire',
    );
  }
  const [tlsCertFile, tlsKeyFile] = pair(
    env,
    'GATEWAY_TLS_CERT_FILE',
    'GATEWAY_TLS_KEY_FILE',
    false,
  );
  const [adminTlsCertFile, adminTlsKeyFile] = pair(
    env,
    'GATEWAY_ADMIN_TLS_CERT_FILE',
    'GATEWAY_ADMIN_TLS_KEY_FILE',
    false,
  );
  const [centralClientCertFile, centralClientKeyFile] = pair(
    env,
    'GATEWAY_CENTRAL_CLIENT_CERT_FILE',
    'GATEWAY_CENTRAL_CLIENT_KEY_FILE',
    production,
  );
  if (centralClientKeyFile !== null) {
    // Décision 32 : fichier de clé durci, en production comme en test (les fixtures posent 0600).
    const violations = clientKeyFileViolations(centralClientKeyFile, production);
    if (violations.length > 0) throw new ConfigError(violations.join(' ; '));
  }
  const deviceCaFile = text(env, 'GATEWAY_DEVICE_CA_FILE');
  if (tlsCertFile !== null && deviceCaFile === null) {
    throw new ConfigError(
      'GATEWAY_DEVICE_CA_FILE manquant : autorité des terminaux exigée avec TLS',
    );
  }
  const keystore = text(env, 'HARDWARE_KEYSTORE') ?? (production ? null : 'fake');
  if (keystore === null) {
    throw new ConfigError('HARDWARE_KEYSTORE manquant : port matériel obligatoire en production');
  }
  if (keystore !== 'fake' && keystore !== 'hardware') {
    throw new ConfigError('HARDWARE_KEYSTORE : fake ou hardware attendu');
  }

  return {
    nodeEnv: resolved,
    production,
    databaseUrl,
    centralUrl: mandatory(env, 'GATEWAY_CENTRAL_URL', production, 'adresse du central'),
    listenPort: port(env, 'GATEWAY_LISTEN_PORT', production, 8443),
    tlsCertFile,
    tlsKeyFile,
    deviceCaFile,
    centralClientCertFile,
    centralClientKeyFile,
    requestAuthority: mandatory(
      env,
      'GATEWAY_REQUEST_AUTHORITY',
      production,
      'adresse de la passerelle signée par les terminaux',
    ),
    enrollmentFile: text(env, 'GATEWAY_ENROLLMENT_FILE'),
    hardwareKeystore: keystore,
    failpoint: text(env, 'EDGE_FAILPOINT'),
    allowFailpoints: text(env, 'EDGE_ALLOW_FAILPOINTS'),
    identityJwksUrl: text(env, 'GATEWAY_IDENTITY_JWKS_URL'),
    identityVerifier: text(env, 'GATEWAY_IDENTITY_VERIFIER'),
    identityIssuer: text(env, 'GATEWAY_IDENTITY_ISSUER'),
    identityAudience: text(env, 'GATEWAY_IDENTITY_AUDIENCE'),
    adminPort: port(env, 'GATEWAY_ADMIN_PORT', production, 8444),
    edgeCa: text(env, 'EDGE_CA'),
    devKeyFile: text(env, 'GATEWAY_DEV_KEY_FILE'),
    purgeMarkerFile: text(env, 'GATEWAY_PURGE_MARKER_FILE'),
    adminTlsCertFile,
    adminTlsKeyFile,
  };
}
