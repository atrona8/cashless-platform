// Garde de production du processus `maintenance` (WP10) : refus de démarrer sans DATABASE_URL_MAINT, et aucun faux
// dans ce processus (`assertProcessIsSafe` passe hors production). Règle I1 (12b-1) : en
// production, la copie externe `fake` est refusée, et la copie réelle l'est tant que `seal-copy`
// n'est pas essayé.
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../../src/config/config';
import { DEVICE_IDENTITY } from '../../../src/device-identity/device-identity.port';
import { KMS_PROVIDER } from '../../../src/kms/kms.module';
import { UntriedInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { FakeSealCopy } from '../../../src/sealing/fake-seal-copy';
import { SEAL_COPY } from '../../../src/security/port-tokens';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
import { MAINT_URL } from '../../support/db';
import { DEVICE_PRODUCTION } from '../../support/tls';

const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://cashless_app:s@127.0.0.1:1/c',
  DATABASE_URL_PLATFORM: 'postgres://cashless_platform:s@127.0.0.1:1/c',
  OIDC_ISSUER: 'https://id.example',
  OIDC_AUDIENCE: 'a',
  OIDC_APPROVAL_AUDIENCE: 'b',
  OIDC_JWKS_URI: 'https://id.example/jwks.json',
  CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
  TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
  CLAIM_CODE_DOMAIN: 'pay.example.org',
  TRUST_PROXY_HOPS: '1',
  ...DEVICE_PRODUCTION,
};
// Vraie connexion `cashless_maint` : depuis OP-N95 (WP21), la garde vérifie le rôle en base au démarrage en
// production (ni propriétaire, ni superutilisateur, ni BYPASSRLS, membre de cashless_maint).
const MAINT = MAINT_URL;

describe('processus maintenance : garde de production', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.DATABASE_URL_MAINT;
    Object.assign(process.env, PRODUCTION);
  });
  afterEach(() => {
    for (const key of [
      ...Object.keys(PRODUCTION),
      'DATABASE_URL_MAINT',
      'SEAL_COPY',
      'SEAL_COPY_BUCKET',
    ])
      delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('refuse de démarrer en production si DATABASE_URL_MAINT est vide ou absent', async () => {
    await expect(
      Test.createTestingModule({ imports: [MaintenanceProcessModule] }).compile(),
    ).rejects.toThrow(/DATABASE_URL_MAINT manquant/);
    process.env.DATABASE_URL_MAINT = '';
    await expect(
      Test.createTestingModule({ imports: [MaintenanceProcessModule] }).compile(),
    ).rejects.toThrow(/DATABASE_URL_MAINT manquant/);
  });

  // Règle I1 (mission 12b-1) : en production, `fake` posé est refusé, et un réglage absent vaut
  // `real`, que la liste PRODUCTION_ENABLED_SERVICES (vide) refuse encore : trois refus distincts.
  it('refuse de démarrer en production : SEAL_COPY=fake posé', async () => {
    process.env.DATABASE_URL_MAINT = MAINT;
    process.env.SEAL_COPY = 'fake';
    await expect(
      Test.createTestingModule({ imports: [MaintenanceProcessModule] }).compile(),
    ).rejects.toThrow(/SEAL_COPY : « fake » refusé en production/);
  });

  it('refuse de démarrer en production : la copie externe des scellements est un faux', async () => {
    process.env.DATABASE_URL_MAINT = MAINT;
    // Configuration contournant la lecture de l'environnement : la fabrique refuse aussi le faux.
    const config: AppConfig = {
      ...loadConfig(),
      externalModes: { psp: 'real', pspSecrets: 'real', kms: 'real', sealCopy: 'fake' },
    };
    await expect(
      Test.createTestingModule({ imports: [MaintenanceProcessModule] })
        .overrideProvider(APP_CONFIG)
        .useValue(config)
        .compile(),
    ).rejects.toThrow(/la copie externe des scellements/);
  });

  it('refuse de démarrer en production : copie réelle (absent) non essayée', async () => {
    process.env.DATABASE_URL_MAINT = MAINT;
    process.env.SEAL_COPY_BUCKET = 'seals-test';
    const error = await Test.createTestingModule({ imports: [MaintenanceProcessModule] })
      .compile()
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(UntriedInProductionError);
    expect((error as Error).message).toMatch(/seal-copy/);
  });

  it('démarre hors production : le faux est admis, la garde passe, aucun faux terminal ni clé', async () => {
    process.env.DATABASE_URL_MAINT = MAINT;
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [MaintenanceProcessModule],
    }).compile();
    try {
      expect(() => assertProcessIsSafe(moduleRef as never)).not.toThrow();
      expect(moduleRef.get(SEAL_COPY, { strict: false })).toBeInstanceOf(FakeSealCopy);
      // Ni faux terminal ni service de clés dans ce processus.
      for (const token of [KMS_PROVIDER, DEVICE_IDENTITY])
        expect(() => moduleRef.get(token, { strict: false })).toThrow();
    } finally {
      await moduleRef.close();
    }
  });
});
