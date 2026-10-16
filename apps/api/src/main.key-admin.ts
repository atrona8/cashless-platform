// Commande d'administration des clés, lancée par l'exploitant : `--list` montre les travaux en attente, `--once` les
// exécute puis s'arrête. Seul point d'entrée qui peut créer ou désactiver une clé du service de clés.
import 'reflect-metadata';
import { runWorkers } from './processes/bootstrap';
import { KeyAdminProcessModule } from './processes/key-admin.module';

runWorkers(KeyAdminProcessModule, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
