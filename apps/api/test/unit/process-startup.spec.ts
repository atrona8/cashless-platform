// Démarrage avec le vrai `NestFactory` : les autres suites passent par `Test.createTestingModule` ou un faux objet, et
// n'auraient pas vu qu'un service absent du processus (cas normal : l'API publique n'a pas de KMS) l'arrêtait.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { APP_CONFIG, corsAllowAll, loadConfig, type AppConfig } from '../../src/config/config';
import { FakeKms } from '../../src/kms/fake-kms';
import { KMS_PROVIDER } from '../../src/kms/kms.module';
import { FakeInProductionError } from '../../src/kms/production-guard';
import { runWorkers, serve } from '../../src/processes/bootstrap';
import { WorkerRegistry } from '../../src/processes/worker';

const config = (production: boolean): AppConfig => ({ ...loadConfig(), production });

@Module({ providers: [{ provide: APP_CONFIG, useValue: config(false) }, WorkerRegistry] })
class WithoutOptionalServices {}

@Module({
  providers: [
    { provide: APP_CONFIG, useValue: config(true) },
    { provide: KMS_PROVIDER, useClass: FakeKms },
    WorkerRegistry,
  ],
})
class FakeInProduction {}

describe('démarrage réel des processus', () => {
  // Le journal de Nest signale chaque jeton absent : sans intérêt ici, seule l'issue du démarrage compte.
  beforeEach(() => jest.spyOn(process.stderr, 'write').mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  it('un processus HTTP sans service optionnel démarre et répond', async () => {
    const create = jest.spyOn(NestFactory, 'create');
    await serve(WithoutOptionalServices, 0);
    const app = (await create.mock.results[0]?.value) as INestApplication;
    try {
      await request(app.getHttpServer()).get('/v1/absente').expect(404);
    } finally {
      await app.close();
    }
  });

  describe('CORS (ADR-154)', () => {
    const preflight = async (): Promise<string | undefined> => {
      const create = jest.spyOn(NestFactory, 'create');
      await serve(WithoutOptionalServices, 0);
      const app = (await create.mock.results[0]?.value) as INestApplication;
      try {
        const res = await request(app.getHttpServer())
          .options('/v1/absente')
          .set('Origin', 'https://client.example')
          .set('Access-Control-Request-Method', 'POST');
        return res.headers['access-control-allow-origin'];
      } finally {
        await app.close();
      }
    };
    afterEach(() => {
      delete process.env.CORS_ALLOW_ALL;
    });

    it('sans le réglage, aucun en-tête CORS', async () => {
      await expect(preflight()).resolves.toBeUndefined();
    });

    it('avec CORS_ALLOW_ALL=1, toutes les origines', async () => {
      process.env.CORS_ALLOW_ALL = '1';
      await expect(preflight()).resolves.toBe('*');
    });

    it('refusé en production, et toute autre valeur refusée', () => {
      expect(() => corsAllowAll({ NODE_ENV: 'production', CORS_ALLOW_ALL: '1' })).toThrow(
        /interdit en production/,
      );
      expect(() => corsAllowAll({ NODE_ENV: 'development', CORS_ALLOW_ALL: 'true' })).toThrow(
        /1 attendu/,
      );
      expect(corsAllowAll({ NODE_ENV: 'production' })).toBe(false);
    });
  });

  it('un processus sans route et sans service optionnel démarre', async () => {
    await expect(runWorkers(WithoutOptionalServices, ['--list'])).resolves.toBe(0);
  });

  it('un faux en production reste refusé (la garde voit toujours les services présents)', async () => {
    await expect(runWorkers(FakeInProduction, ['--list'])).rejects.toBeInstanceOf(
      FakeInProductionError,
    );
  });
});
