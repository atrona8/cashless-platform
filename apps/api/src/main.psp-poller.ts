// Point d'entrée du processus `psp-poller` (mission 6, lot WP12). `--once` : un passage, code de sortie d'alerte
// (2 interrogation en échec, 3 événement abandonné, 4 purge en échec) ; `--list` : ce qui attend, sans rien écrire.
import 'reflect-metadata';
import { runWorkers } from './processes/bootstrap';
import { PspPollerProcessModule } from './processes/psp-poller.module';

runWorkers(PspPollerProcessModule, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
