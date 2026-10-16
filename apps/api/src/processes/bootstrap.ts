// Démarrage commun des processus (mission bracelets-nfc) : garde « aucun faux en production » (NFR-010), puis écoute
// HTTP ou passage des travailleurs. Chaque point d'entrée (`main*.ts`) n'est qu'un appel à ces fonctions.
import type { INestApplication, INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX, APP_CONFIG, type AppConfig } from '../config/config';
import { CUSTOMER_IDENTITY } from '../customer-identity/customer-identity.port';
import { DEVICE_IDENTITY } from '../device-identity/device-identity.port';
import { KMS_PROVIDER } from '../kms/kms.module';
import { assertNoFakeInProduction } from '../kms/production-guard';
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

function pollSeconds(): number {
  const raw = process.env.TAG_JOB_POLL_SECONDS;
  if (raw === undefined || raw === '') return 5;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3600) throw new Error(`TAG_JOB_POLL_SECONDS : entier de 0 à 3600 attendu (reçu « ${raw} »)`);
  return parsed;
}

/** Processus HTTP : écoute sur `port`, et fait tourner ses travailleurs à intervalle (0 = jamais). */
export async function serve(rootModule: Type<unknown>, port: number): Promise<void> {
  const app = await NestFactory.create(rootModule, { bufferLogs: true });
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
        .catch((error: unknown) => console.error('[travaux]', error instanceof Error ? error.message : error))
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
