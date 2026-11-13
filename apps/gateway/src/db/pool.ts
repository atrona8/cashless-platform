// Seul fichier de la passerelle qui importe `pg` et crée un pool (test d'architecture :
// `architecture.spec.ts`).
// Un seul pool, une seule base locale (rôle `edge_app`). Toute autre utilisation de `pg` passe par
// ce fichier.
import { Client, Pool, type PoolClient } from 'pg';

export const GATEWAY_POOL = Symbol('GATEWAY_POOL');

export type GatewayPool = Pool;
/** Client fourni à l'intérieur d'une transaction : sa durée de vie est celle de `GatewayTx.run`. */
export type TxClient = Pick<PoolClient, 'query'>;

/**
 * Pool unique de la passerelle. `synchronous_commit = on` est un paramètre de démarrage de CHAQUE
 * connexion : une réponse au terminal ne
 * part qu'après l'écriture durable (FR-014, NFR-004).
 */
export function createGatewayPool(connectionString: string): GatewayPool {
  // Paramètre de démarrage de la connexion : appliqué avant toute requête (pas de `SET` en vol qui
  // course la première).
  const pool = new Pool({ connectionString, max: 10, options: '-c synchronous_commit=on' });
  // Une connexion inactive qui meurt ne doit pas faire tomber le processus : la requête suivante en
  // ouvre une autre.
  pool.on('error', () => undefined);
  return pool;
}

/** Connexion NUE (hors pool) : la garde de démarrage lit les réglages du serveur tels qu'ils sont, sans notre `SET`. */
export async function openBareConnection(connectionString: string): Promise<{
  query: Client['query'];
  end(): Promise<void>;
}> {
  const client = new Client({ connectionString });
  await client.connect();
  return { query: client.query.bind(client) as Client['query'], end: () => client.end() };
}
