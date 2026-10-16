// Point d'entrée du contrôle quotidien des mots de passe stockés (SPECIFICATION §7.4). `--once` : un passage.
import 'reflect-metadata';
import { runWorkers } from './processes/bootstrap';
import { TagCheckProcessModule } from './processes/tag-check.module';

runWorkers(TagCheckProcessModule, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
