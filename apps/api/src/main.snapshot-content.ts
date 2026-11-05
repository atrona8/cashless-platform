// Point d'entrée du processus `snapshot-content` (mission hors-ligne-snapshots-lots, WP11).
// `--once` : un passage
// complet (attend les FULL en cours), code de sortie d'alerte (2 grand livre en échec trois
// passages de suite,
// 3 service de clés indisponible) ; `--list` : prochaine version due par grand livre, sans rien
// écrire.
import 'reflect-metadata';
import { loadConfig } from './config/config';
import { runWorkers } from './processes/bootstrap';
import { SnapshotContentProcessModule } from './processes/snapshot-content.module';

runWorkers(SnapshotContentProcessModule, process.argv.slice(2), {
  pollSeconds: loadConfig().snapshotPollSeconds,
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
