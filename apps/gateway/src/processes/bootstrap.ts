// Démarrage de la passerelle. Ordre (la garde passe AVANT toute ouverture de port) :
//   1. `loadConfig` (échec fermé) puis `evaluateConfigRules` : si une règle de production est
// violée, le démarrage est
//      refusé ICI, avant toute connexion à la base et avant tout port ;
//   2. `NestFactory.create` (le pool ne se connecte pas tant qu'aucune requête n'est faite) puis
// contrôle des objets
//      réellement instanciés (`evaluateProviderRules`) ;
//   3. réglages du serveur PostgreSQL local (`evaluateServerRules`, connexion nue) ;
//   4. migrations, horloge (`t0 = max(heure système, time_floor)`), enrôlement exigé, points
// d'arrêt ;
//   5. seulement alors, écoute TLS (1.3, certificat client demandé ; clair permis en `development`
// et `test`).
import { readFileSync } from 'node:fs';
import type { ServerOptions } from 'node:https';
import { NestFactory } from '@nestjs/core';
import type {
  INestApplication,
  INestApplicationContext,
  NestApplicationOptions,
} from '@nestjs/common';
import { loadConfig, type GatewayConfig } from '../config/config';
import { AuthorityRuntime } from '../authority/authority.module';
import { REPLICATION_CATCH_UP } from '../authority/ports';
import { ReplicationLoop } from '../replication/replication-loop';
import { GatewayClockService } from '../clock/gateway-clock';
import { applyMigrations } from '../db/migrate';
import { GATEWAY_POOL, type GatewayPool } from '../db/pool';
import { clientKeyDistinctViolations } from '../config/client-key-file';
import { DrainService } from '../queue/drain.service';
import { QueueRuntime } from '../queue/queue.module';
import { PurgeRuntime } from '../purge/purge.module';
import { SnapshotWorker } from '../snapshots/snapshot-worker';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { HARDWARE_KEYSTORE } from '../key-store/hardware-keystore.port';
import { configureFailpoints } from '../testing/failpoints';
import { GatewayModule } from './gateway.module';
import {
  assertNoViolation,
  evaluateConfigRules,
  evaluateProviderRules,
  evaluateServerRules,
  readServerSettings,
} from './startup-guard';

export type TlsServerOptions = NonNullable<NestApplicationOptions['httpsOptions']> &
  Pick<ServerOptions, 'minVersion'>;

/** Options HTTPS (TLS 1.3 minimum, certificat client DEMANDÉ ; la garde des terminaux juge, lot 19). */
export function tlsServerOptions(
  config: Pick<GatewayConfig, 'tlsCertFile' | 'tlsKeyFile' | 'deviceCaFile'>,
): TlsServerOptions | undefined {
  if (config.tlsCertFile === null || config.tlsKeyFile === null) return undefined;
  if (config.deviceCaFile === null)
    throw new Error('GATEWAY_DEVICE_CA_FILE manquant : exigé avec TLS');
  const read = (name: string, file: string): Buffer => {
    try {
      return readFileSync(file);
    } catch {
      // Nomme la variable, jamais le contenu.
      throw new Error(`${name} : fichier illisible`);
    }
  };
  return {
    key: read('GATEWAY_TLS_KEY_FILE', config.tlsKeyFile),
    cert: read('GATEWAY_TLS_CERT_FILE', config.tlsCertFile),
    ca: read('GATEWAY_DEVICE_CA_FILE', config.deviceCaFile),
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
  };
}

/**
 * Temps 2 de la garde, commun au démarrage et aux commandes hors service (`request`, `enroll`, `migrate`) : objets
 * réellement instanciés puis réglages du serveur PostgreSQL local, AVANT toute écriture.
 */
export async function assertRuntimeSafe(
  config: GatewayConfig,
  app: INestApplicationContext,
): Promise<void> {
  let catchUp: unknown;
  try {
    catchUp = app.get(REPLICATION_CATCH_UP, { strict: false });
  } catch {
    catchUp = undefined;
  }
  const keystore = app.get(HARDWARE_KEYSTORE);
  assertNoViolation([
    ...evaluateProviderRules(config, {
      keystore,
      catchUp,
      deltaPurgeProvided: app.get(DrainService, { strict: false }).hasDeltaPurge,
    }),
    // Décision 32 : la clé TLS client n'est pas une clé du port (toujours, production ou non).
    ...(await clientKeyDistinctViolations(
      config.centralClientKeyFile,
      keystore,
      config.production,
    )),
  ]);
  assertNoViolation(evaluateServerRules(config, await readServerSettings(config.databaseUrl)));
}

export interface RunningGateway {
  app: INestApplication;
  config: GatewayConfig;
  port: number;
}

export async function startGateway(env: NodeJS.ProcessEnv = process.env): Promise<RunningGateway> {
  const config = loadConfig(env);
  // Temps 1 : aucune connexion à la base, aucun port.
  assertNoViolation(evaluateConfigRules({ config, env }));
  const failpoints = configureFailpoints({
    nodeEnv: config.nodeEnv,
    failpoint: config.failpoint,
    allowFailpoints: config.allowFailpoints,
  });

  const httpsOptions = tlsServerOptions(config);
  const app = await NestFactory.create(GatewayModule, {
    abortOnError: false,
    bufferLogs: true,
    // Octets bruts du corps : `Content-Digest` des requêtes signées (WP19, RFC 9530).
    rawBody: true,
    ...(httpsOptions ? { httpsOptions } : {}),
  });
  try {
    await assertRuntimeSafe(config, app);
    const pool = app.get<GatewayPool>(GATEWAY_POOL);
    await applyMigrations(pool);
    // WP24 : une purge commencée est terminée avant tout service ; une purge terminée refuse.
    await app.get(PurgeRuntime).enforceAtStartup();
    await app.get(GatewayClockService).start();
    await app.get(EnrollmentService).assertEnrolled();
    if (failpoints.refused) {
      await pool.query(
        `INSERT INTO edge_audit (kind, actor, detail) VALUES ('FAILPOINT_REFUSED', 'gateway', $1)`,
        [JSON.stringify({ failpoint: failpoints.name, node_env: config.nodeEnv })],
      );
    }
    app.enableShutdownHooks();
    await app.listen(config.listenPort);
    // WP17 : reprise de l'autorité (A13), écouteur d'administration local, canal de contrôle.
    await app.get(AuthorityRuntime).start();
    // WP18 : boucle de réplication (après la reprise de l'autorité).
    await app.get(ReplicationLoop).start();
    // WP20 : vidage de la file vers le central.
    app.get(QueueRuntime).start();
    // WP23 : production des snapshots signés par la clé propre de la passerelle.
    app.get(SnapshotWorker).start();
    // WP24 : déclencheur de la purge automatique (événement CLOS et file acquittée).
    app.get(PurgeRuntime).start();
    const address = app.getHttpServer().address() as { port: number };
    process.stdout.write(
      `GATEWAY listening ${httpsOptions ? 'https' : 'http'} port=${address.port}\n`,
    );
    return { app, config, port: address.port };
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}
