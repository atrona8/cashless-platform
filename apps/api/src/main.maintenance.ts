// Point d'entrée du processus `maintenance` (mission hors-ligne-snapshots-lots, WP10). `--once` : un passage des
// purges des terminaux, code de sortie d'alerte 0 (aucun travailleur n'en lève) ; `--list` : ce qui attend, sans rien
// écrire.
import 'reflect-metadata';
import { runWorkers } from './processes/bootstrap';
import { MaintenanceProcessModule } from './processes/maintenance.module';

runWorkers(MaintenanceProcessModule, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
