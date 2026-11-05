// Garde de production du processus `maintenance` (WP10) : refus de démarrer sans DATABASE_URL_MAINT, et aucun faux
// dans ce processus (`assertProcessIsSafe` passe en production).
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DEVICE_IDENTITY } from '../../../src/device-identity/device-identity.port';
import { KMS_PROVIDER } from '../../../src/kms/kms.module';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { MaintenanceProcessModule } from '../../../src/processes/maintenance.module';
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
const MAINT = 'postgres://cashless_maint:s@127.0.0.1:1/c';

describe('processus maintenance : garde de production', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.DATABASE_URL_MAINT;
    Object.assign(process.env, PRODUCTION);
  });
  afterEach(() => {
    for (const key of [...Object.keys(PRODUCTION), 'DATABASE_URL_MAINT']) delete process.env[key];
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

  it('démarre en production avec DATABASE_URL_MAINT : aucun faux, la garde passe', async () => {
    process.env.DATABASE_URL_MAINT = MAINT;
    const moduleRef = await Test.createTestingModule({
      imports: [MaintenanceProcessModule],
    }).compile();
    try {
      expect(() => assertProcessIsSafe(moduleRef as never)).not.toThrow();
      // Ni faux terminal ni service de clés dans ce processus.
      for (const token of [KMS_PROVIDER, DEVICE_IDENTITY])
        expect(() => moduleRef.get(token, { strict: false })).toThrow();
    } finally {
      await moduleRef.close();
    }
  });
});
