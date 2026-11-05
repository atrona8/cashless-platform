// Point d'entrée du processus `snapshot-signer` (WP13). `--once` : un passage, code de sortie d'alerte (2 trou ou
// RETRY de plus de 24 h, 3 brouillon altéré / clé absente / service de clés ou signature en échec) ; `--list` : les
// brouillons à signer et les alertes dues, sans rien écrire. Sans option : repasse toutes les SNAPSHOT_POLL_SECONDS.
import 'reflect-metadata';
import { loadConfig } from './config/config';
import { runWorkers } from './processes/bootstrap';
import { SnapshotSignerProcessModule } from './processes/snapshot-signer.module';

runWorkers(SnapshotSignerProcessModule, process.argv.slice(2), {
  pollSeconds: loadConfig().snapshotPollSeconds,
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
