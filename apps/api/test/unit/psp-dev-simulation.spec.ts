// Secrets PSP de démo et route de simulation : développement seulement (OP-N121, ADR-181). Aucun faux en
// production : le coffre factice reste refusé, la route n'existe pas (404), son fabricant refuse de se construire.
import { Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PspSecretError } from '../../src/psp/psp-secret-store.port';
import { FakePspSecretStore } from '../../src/psp/fake/fake-psp-secret-store';
import { createDevNotificationFabricator, createPspSecretStore } from '../../src/psp/psp.providers';
import { FakeInProductionError } from '../../src/kms/production-guard';
import {
  DevPspSimulationModule,
  devPspSimulationImports,
} from '../../src/dev/psp-simulation.module';
import { API_PREFIX } from '../../src/config/config';
import { Secret } from '../../src/psp/secret';

const HOLDER = '670e7622-7536-491a-8217-92df69fa9b61';
const OTHER = '707b372c-eb22-4070-b9d8-49200b1804ba';
const bind = (holder: string, name: string) => ({
  configurationId: 'c',
  holderPartyId: holder,
  secretRef: `psp/${holder}/${name}`,
});

describe('faux coffre PSP : secrets de démo', () => {
  const store = new FakePspSecretStore();

  it.each(['demo-wave', 'demo-om', 'demo-card'])('%s : secrets déterministes', async (name) => {
    const a = await store.get(bind(HOLDER, name));
    const b = await new FakePspSecretStore().get(bind(HOLDER, name));
    expect(a.notification.current.reveal()).toBe(b.notification.current.reveal());
    expect(a.notification.current.reveal()).toMatch(/^[0-9a-f]{64}$/);
    expect(a.adapter).not.toBeNull();
  });

  it('secrets distincts par titulaire et par moyen', async () => {
    const ref = async (h: string, n: string) =>
      (await store.get(bind(h, n))).notification.current.reveal();
    expect(await ref(HOLDER, 'demo-wave')).not.toBe(await ref(OTHER, 'demo-wave'));
    expect(await ref(HOLDER, 'demo-wave')).not.toBe(await ref(HOLDER, 'demo-om'));
  });

  it.each(['prod-wave', 'demo-wave2', 'demo-', 'test-wave', 'demo-other', 'xdemo-wave'])(
    'référence hors demo-<moyen> (%s) : introuvable',
    async (name) => {
      await expect(store.get(bind(HOLDER, name))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it('le contrôle titulaire / référence reste en place', async () => {
    await expect(
      store.get({ ...bind(HOLDER, 'demo-wave'), holderPartyId: OTHER }),
    ).rejects.toBeInstanceOf(PspSecretError);
    await expect(
      store.get({ ...bind(HOLDER, 'demo-wave'), holderPartyId: OTHER }),
    ).rejects.toMatchObject({ code: 'HOLDER_MISMATCH' });
  });

  it('une entrée posée par put prime sur la dérivation', async () => {
    const own = new FakePspSecretStore();
    own.put(`psp/${HOLDER}/demo-wave`, { current: 'posé' });
    expect((await own.get(bind(HOLDER, 'demo-wave'))).notification.current.reveal()).toBe('posé');
  });

  it('production : le coffre factice n’est jamais construit', () => {
    expect(createPspSecretStore({ production: true })).not.toBeInstanceOf(FakePspSecretStore);
    expect(createPspSecretStore({ production: false })).toBeInstanceOf(FakePspSecretStore);
  });
});

describe('route de simulation : absente en production', () => {
  const secret = Secret.of('x');
  const input = {
    provider: 'WAVE',
    secret,
    outcome: 'SUCCEEDED',
    notificationId: 'n',
    merchantReference: 'm',
    paymentId: 'p',
    amount: 1,
    currency: 'XOF',
  } as const;

  it('le fabricant de notifications refuse de se construire en production', () => {
    expect(() => createDevNotificationFabricator({ production: true })).toThrow(
      FakeInProductionError,
    );
    const signed = createDevNotificationFabricator({ production: false })(input);
    expect(signed.headers['wave-signature']).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
  });

  it('le module n’est chargé que pour NODE_ENV development ou test', () => {
    expect(devPspSimulationImports({ NODE_ENV: 'development' })).toEqual([DevPspSimulationModule]);
    expect(devPspSimulationImports({ NODE_ENV: 'test' })).toEqual([DevPspSimulationModule]);
    for (const NODE_ENV of ['production', 'prod', 'staging', '', undefined])
      expect(devPspSimulationImports({ NODE_ENV })).toEqual([]);
    expect(Reflect.getMetadata('imports', AppModule)).toContain(DevPspSimulationModule);
  });

  it('AppModule chargé avec NODE_ENV=production : le module de simulation n’y figure pas', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { AppModule: Prod } = require('../../src/app.module') as { AppModule: object };
        const names = (Reflect.getMetadata('imports', Prod) as Array<{ name?: string }>).map(
          (m) => m.name,
        );
        expect(names).toContain('PspTopupsModule');
        expect(names).not.toContain('DevPspSimulationModule');
      });
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('application montée comme en production : POST /__dev/psp-topups/{id}/outcome répond 404', async () => {
    @Controller('v1')
    class NeutralController {
      @Post('health-like')
      ok() {
        return { ok: true };
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: devPspSimulationImports({ NODE_ENV: 'production' }),
      controllers: [NeutralController],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      const url = `/${API_PREFIX}/__dev/psp-topups/670e7622-7536-491a-8217-92df69fa9b61/outcome`;
      expect((await request(app.getHttpServer()).post('/v1/health-like')).status).toBe(201);
      const res = await request(app.getHttpServer()).post(url).send({ outcome: 'SUCCEEDED' });
      expect(res.status).toBe(404);
      const direct = await request(app.getHttpServer())
        .post('/v1/__dev/psp-topups/670e7622-7536-491a-8217-92df69fa9b61/outcome')
        .send({ outcome: 'SUCCEEDED' });
      expect(direct.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
