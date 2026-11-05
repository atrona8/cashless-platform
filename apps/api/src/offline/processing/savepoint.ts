// SAVEPOINT autour d'un appel dont l'échec attendu ne doit pas annuler la transaction de l'opération
// (modèle de topups/psp/psp-payment-processor.ts). Relance l'erreur après le retour au point de sauvegarde.
import type { TxClient } from '../../db/tenant-tx';

let counter = 0;

export async function inSavepoint<T>(client: TxClient, fn: () => Promise<T>): Promise<T> {
  const name = `offline_sp_${(counter += 1)}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const value = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
