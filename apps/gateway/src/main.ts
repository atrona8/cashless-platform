// Point d'entrée mince de la passerelle (interfaces.md § 3). Commandes :
//   (aucune)                           démarre la passerelle (garde de démarrage avant tout port et
// toute base) ;
//   migrate                            joue les migrations `edge-NNNN` puis s'arrête ;
//   request --serial S --role R --out F  crée les clés du port matériel et écrit la demande
// d'inscription ;
//   enroll <fichier>                   valide le fichier d'enrôlement, remplit la base locale,
// supprime le fichier.
// Un refus (garde, configuration, enrôlement) écrit sa raison sur la sortie d'erreur, sans valeur
// secrète, et sort en 1.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config/config';
import { applyMigrations } from './db/migrate';
import { GATEWAY_POOL, type GatewayPool } from './db/pool';
import { EnrollmentService } from './enrollment/enrollment.service';
import { assertRuntimeSafe, startGateway } from './processes/bootstrap';
import { GatewayModule } from './processes/gateway.module';
import { assertNoViolation, evaluateConfigRules } from './processes/startup-guard';

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Commandes hors service : même garde de configuration, puis un contexte sans écoute. */
async function offline(command: string, args: string[]): Promise<void> {
  const config = loadConfig();
  assertNoViolation(evaluateConfigRules({ config, env: process.env }));
  const app = await NestFactory.createApplicationContext(GatewayModule, { abortOnError: false });
  try {
    await assertRuntimeSafe(config, app);
    await applyMigrations(app.get<GatewayPool>(GATEWAY_POOL));
    const enrollment = app.get(EnrollmentService);
    if (command === 'request') {
      const serial = option(args, '--serial');
      const role = option(args, '--role');
      const out = option(args, '--out');
      if (
        !serial ||
        !out ||
        (role !== 'PRIMARY' && role !== 'STANDBY') ||
        !config.requestAuthority
      ) {
        throw new Error(
          'usage : request --serial S --role PRIMARY|STANDBY --out F (GATEWAY_REQUEST_AUTHORITY posé)',
        );
      }
      await enrollment.writeRequest(out, { serial, role, lanAuthority: config.requestAuthority });
      process.stdout.write('demande écrite\n');
    } else if (command === 'enroll') {
      const file = args[0];
      if (!file) throw new Error('usage : enroll <fichier>');
      await enrollment.enroll(file);
      process.stdout.write('passerelle enrôlée, fichier supprimé\n');
    } else {
      process.stdout.write('migrations jouées\n');
    }
  } finally {
    await app.close();
  }
}

async function run(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    await startGateway();
  } else if (command === 'migrate' || command === 'request' || command === 'enroll') {
    await offline(command, args);
  } else {
    throw new Error(`commande inconnue : ${command}`);
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `GATEWAY REFUSED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
