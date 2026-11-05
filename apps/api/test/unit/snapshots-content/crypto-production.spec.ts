// Câblage du processus snapshot-content (WP12) : le chiffreur réel et le travailleur d'enveloppes
// sont en
// place ; le faux service de clés refuse le démarrage en production (aucun faux en production,
// NFR-010).
import { Test } from '@nestjs/testing';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KMS_PROVIDER } from '../../../src/kms/kms.module';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { SnapshotContentProcessModule } from '../../../src/processes/snapshot-content.module';
import { WorkerRegistry } from '../../../src/processes/worker';
import { SnapshotEntryEncryptor } from '../../../src/snapshots-content/crypto/snapshot-entry-encryptor';
import { ENTRY_ENCRYPTOR } from '../../../src/snapshots-content/entry-encryptor';
import { DEVICE_PRODUCTION } from '../../support/tls';

const BASE = {
  DATABASE_URL_SNAPCONTENT: 'postgres://cashless_snapcontent:s@127.0.0.1:1/c',
};
const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://cashless_app:s@127.0.0.1:1/c',
  DATABASE_URL_PLATFORM: 'postgres://cashless_platform:s@127.0.0.1:1/c',
  ...BASE,
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

describe('processus snapshot-content : câblage du chiffrement', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of [...Object.keys(PRODUCTION), 'NODE_ENV']) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('hors production : chiffreur réel (non provisoire) et travailleur d’enveloppes', async () => {
    Object.assign(process.env, BASE, { NODE_ENV: 'test' });
    const app = await Test.createTestingModule({
      imports: [SnapshotContentProcessModule],
    }).compile();
    try {
      expect(app.get(ENTRY_ENCRYPTOR, { strict: false })).toBeInstanceOf(SnapshotEntryEncryptor);
      const registry = app.get(WorkerRegistry, { strict: false });
      expect(registry.names().sort()).toEqual(['snapshot-content', 'snapshot-wrapping']);
      expect(app.get(KMS_PROVIDER, { strict: false })).toBeInstanceOf(FakeKms);
    } finally {
      await app.close();
    }
  });

  it('production : le faux service de clés refuse le démarrage du processus', async () => {
    Object.assign(process.env, PRODUCTION);
    await expect(
      Test.createTestingModule({ imports: [SnapshotContentProcessModule] }).compile(),
    ).rejects.toThrow(FakeInProductionError);
  });

  it('production : la garde de démarrage refuse un faux service de clés déjà construit', () => {
    const app = {
      get: (token: unknown) => (token === KMS_PROVIDER ? new FakeKms() : { production: true }),
    };
    expect(() => assertProcessIsSafe(app as never)).toThrow(FakeInProductionError);
  });
});
