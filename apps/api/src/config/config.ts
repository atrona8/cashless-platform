// Configuration lue dans l'environnement (pas de @nestjs/config : aucune dépendance ajoutée).

export interface AppConfig {
  port: number;
  databaseUrl: string;
  poolSize: number;
  problemTypeBase: string;
  production: boolean;
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
  };
}

/** Préfixe global des routes (contrat : /v1). */
export const API_PREFIX = 'v1';

/** Jeton d'injection de la configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
