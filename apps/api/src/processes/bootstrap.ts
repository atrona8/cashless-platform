// Démarrage commun des processus (mission bracelets-nfc) : garde « aucun faux en production » (NFR-010), puis écoute
// HTTPS (ou en clair hors production sans certificat) ou passage des travailleurs. Chaque point d'entrée (`main*.ts`)
// n'est qu'un appel à ces fonctions.
import { readFileSync } from 'node:fs';
import type { ServerOptions } from 'node:https';
import type {
  INestApplication,
  INestApplicationContext,
  NestApplicationOptions,
  Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX, APP_CONFIG, loadConfig, type AppConfig } from '../config/config';
import { CUSTOMER_IDENTITY } from '../customer-identity/customer-identity.port';
import { DEVICE_IDENTITY } from '../device-identity/device-identity.port';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../psp/psp.tokens';
import { KMS_PROVIDER } from '../kms/kms.module';
import { assertNoFakeInProduction, assertSafeTransport } from '../kms/production-guard';
import { ATTESTATION_VERIFIER, DEVICE_CA, TOKEN_SIGNER } from '../security/port-tokens';
import { WorkerRegistry } from './worker';

function optional(app: INestApplicationContext, token: symbol): object | null {
  try {
    return app.get<object>(token, { strict: false });
  } catch {
    return null;
  }
}

/** Refuse de poursuivre si le processus porte un faux en production. Aucun réglage ne désactive ce contrôle. */
export function assertProcessIsSafe(app: INestApplicationContext): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG, { strict: false });
  assertNoFakeInProduction(config.production, {
    'le service de clés': optional(app, KMS_PROVIDER),
    'l’identité du terminal': optional(app, DEVICE_IDENTITY),
    'l’identité du festivalier': optional(app, CUSTOMER_IDENTITY),
    'l’autorité des terminaux': optional(app, DEVICE_CA),
    'le signataire des jetons d’appareil': optional(app, TOKEN_SIGNER),
    'le vérificateur d’attestation': optional(app, ATTESTATION_VERIFIER),
    'les adaptateurs PSP': optional(app, PSP_ADAPTERS),
    'le coffre des secrets PSP': optional(app, PSP_SECRET_STORE),
  });
  return config;
}

/**
 * Source de l'adresse du client (`req.ip`, OP-N53) : `trust proxy` borné au nombre de répartiteurs de confiance du
 * déploiement. 0 : adresse de la connexion, `X-Forwarded-For` ignoré. n : l'adresse lue à n sauts depuis la droite
 * de `X-Forwarded-For` ; ce qu'un client ajoute plus à gauche n'est jamais lu.
 */
export function applyTrustProxy(app: INestApplication, hops: number): void {
  const express = app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void };
  express.set('trust proxy', hops === 0 ? false : hops);
}

/** Options HTTPS de Nest, plus `minVersion` (Nest passe l'objet entier à `https.createServer`). */
export type TlsServerOptions = NonNullable<NestApplicationOptions['httpsOptions']> &
  Pick<ServerOptions, 'minVersion'>;

/**
 * Options du serveur HTTPS (research R-03), ou `undefined` sans certificat configuré (hors production seulement : la
 * configuration l'exige en production). Le certificat client est DEMANDÉ, pas imposé (`rejectUnauthorized: false`) :
 * les personnes et la route d'enrôlement n'en ont pas ; la garde des terminaux exige `socket.authorized` et
 * l'empreinte du terminal, route par route. Seule autorité cliente : celle des terminaux (`ca`), jamais les
 * autorités publiques. TLS 1.3 minimum : aucune renégociation.
 */
export function tlsServerOptions(
  config: Pick<AppConfig, 'tlsCertFile' | 'tlsKeyFile' | 'deviceCaCertFile'>,
): TlsServerOptions | undefined {
  if (config.tlsCertFile === null || config.tlsKeyFile === null) return undefined;
  if (config.deviceCaCertFile === null)
    throw new Error('DEVICE_CA_CERT_FILE manquant : autorité des terminaux exigée avec TLS');
  return {
    key: readFileSync(config.tlsKeyFile),
    cert: readFileSync(config.tlsCertFile),
    ca: readFileSync(config.deviceCaCertFile),
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
  };
}

function pollSeconds(): number {
  const raw = process.env.TAG_JOB_POLL_SECONDS;
  if (raw === undefined || raw === '') return 5;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3600)
    throw new Error(`TAG_JOB_POLL_SECONDS : entier de 0 à 3600 attendu (reçu « ${raw} »)`);
  return parsed;
}

/**
 * Processus HTTP : écoute sur `port` (HTTPS dès qu'un certificat est configuré, toujours en production), et fait
 * tourner ses travailleurs à intervalle (0 = jamais). `rawBody` garde le corps brut pour `Content-Digest` (R-04) ; le
 * corps JSON reste analysé comme avant.
 */
export async function serve(rootModule: Type<unknown>, port: number): Promise<void> {
  // Même environnement que la configuration injectée (APP_CONFIG) : il faut le certificat avant de créer le serveur.
  const transport = loadConfig();
  const httpsOptions = tlsServerOptions(transport);
  assertSafeTransport({
    production: transport.production,
    tls: httpsOptions !== undefined,
    trustProxyHops: transport.trustProxyHops,
  });
  const app = await NestFactory.create(rootModule, {
    bufferLogs: true,
    rawBody: true,
    ...(httpsOptions ? { httpsOptions } : {}),
  });
  const config = assertProcessIsSafe(app);
  applyTrustProxy(app, config.trustProxyHops);
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(port);
  const interval = pollSeconds();
  const workers = optional(app, WorkerRegistry as unknown as symbol) as WorkerRegistry | null;
  if (interval > 0 && workers && workers.names().length > 0) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      workers
        .drain()
        .catch((error: unknown) =>
          console.error('[travaux]', error instanceof Error ? error.message : error),
        )
        .finally(() => {
          running = false;
        });
    }, interval * 1000);
    timer.unref();
  }
}

/**
 * Processus sans route : `--list` décrit ce qui attend, `--once` traite tout ce qui attend puis s'arrête, sans option
 * il repasse à intervalle. Rend le code de sortie (0 : rien à signaler).
 */
export async function runWorkers(rootModule: Type<unknown>, argv: string[]): Promise<number> {
  const app = await NestFactory.createApplicationContext(rootModule, { bufferLogs: true });
  try {
    assertProcessIsSafe(app);
    const workers = app.get(WorkerRegistry, { strict: false });
    if (argv.includes('--list')) {
      for (const line of await workers.describe()) console.log(line);
      return 0;
    }
    if (argv.includes('--once')) {
      console.log(`[travaux] ${await workers.drain()} unité(s) traitée(s)`);
      // Code d'alerte d'un travailleur (contrôle quotidien : 2 écart, 3 panne du service de clés) :
      // l'ordonnanceur alerte sur tout code non nul.
      return workers.alarm();
    }
    const interval = pollSeconds() || 5;
    app.enableShutdownHooks();
    for (;;) {
      await workers.drain();
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
  } finally {
    await app.close();
  }
}
