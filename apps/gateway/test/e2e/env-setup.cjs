// Fichier `setupFiles` de la configuration de bout en bout : avant l'import des aides de l'API
// (`apps/api/test/support/db.ts` lit `DATABASE_URL_*` à l'import), pointe tout vers une base du central
// PROPRE à cette suite (`cashless_m8_central_<id>`, créée ensuite par le banc). Jamais `cashless_test`,
// jamais le port 80 ni 5434 : la même règle est jugée par `disposable-databases.ts`.
const { randomBytes } = require('node:crypto');

const id = process.env.M8_E2E_ID || randomBytes(4).toString('hex');
process.env.M8_E2E_ID = id;
const host = process.env.PGHOST || '127.0.0.1';
const port = process.env.PGPORT || '5433';
const user = process.env.PGUSER || 'postgres';
// Port jugé comme NOMBRE et forme stricte : `080`, ` 80` sont refusés comme `80` (constat 8).
if (!/^[1-9][0-9]{1,4}$/.test(port)) throw new Error(`BANC REFUSÉ : port invalide : ${port}`);
if (Number(port) === 80 || Number(port) === 5434) {
  throw new Error(`BANC REFUSÉ : le port ${port} est celui de l'API du porteur`);
}
// `cashless_test` est réservée à l'orchestrateur : la demander par PGDATABASE est refusé
// explicitement, jamais ignoré en silence (le banc écrase ensuite PGDATABASE par sa base jetable).
if ((process.env.PGDATABASE || '').startsWith('cashless_test')) {
  throw new Error(
    `BANC REFUSÉ : PGDATABASE=${process.env.PGDATABASE} : la base cashless_test est réservée`,
  );
}
const name = `cashless_m8_central_${id}`;
const pw = (role) => process.env[`CASHLESS_${role.toUpperCase()}_PASSWORD`] || `cashless_${role}_local`;
const url = (role) => `postgres://cashless_${role}:${pw(role)}@${host}:${port}/${name}`;
process.env.M8_CENTRAL_DB = name;
process.env.PGDATABASE = name;
process.env.DATABASE_URL_OWNER = `postgres://${user}@${host}:${port}/${name}`;
for (const role of [
  'app', 'platform', 'tagkeys', 'perso', 'tagcheck', 'keyadmin', 'snapcontent', 'snapsign', 'maint',
  'edge', 'edgeadmin',
]) {
  process.env[`DATABASE_URL_${role.toUpperCase()}`] = url(role);
  process.env[`CASHLESS_${role.toUpperCase()}_PASSWORD`] = pw(role);
}
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';

// Le central du banc et le générateur de charge partagent un seul processus : réserve de connexions
// plus large que les 10 de la production pour les essais de charge (T114).
if (!process.env.DB_POOL_SIZE) process.env.DB_POOL_SIZE = '40';
