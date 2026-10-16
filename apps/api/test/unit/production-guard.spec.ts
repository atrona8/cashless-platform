// Aucun faux en production (règle du porteur du 13/10/2026, NFR-010) : un test par faux.
import { loadConfig } from '../../src/config/config';
import { createCustomerIdentity } from '../../src/customer-identity/customer-identity.module';
import { FakeCustomerIdentity } from '../../src/customer-identity/fake-customer-identity';
import { createDeviceIdentity } from '../../src/device-identity/device-identity.module';
import { FakeDeviceIdentity } from '../../src/device-identity/fake-device-identity';
import { FakeKms } from '../../src/kms/fake-kms';
import { createKms } from '../../src/kms/kms.module';
import { assertNoFakeInProduction, FakeInProductionError } from '../../src/kms/production-guard';

const PRODUCTION = { production: true };
const LOCAL = { production: false };

describe('aucun faux en production', () => {
  it('faux service de clés : construction refusée en production', () => {
    expect(() => createKms(PRODUCTION)).toThrow(FakeInProductionError);
    expect(createKms(LOCAL)).toBeInstanceOf(FakeKms);
  });

  it('faux terminal : construction refusée en production', () => {
    expect(() => createDeviceIdentity(PRODUCTION)).toThrow(FakeInProductionError);
    expect(createDeviceIdentity(LOCAL)).toBeInstanceOf(FakeDeviceIdentity);
  });

  it('faux festivalier : construction refusée en production', () => {
    expect(() => createCustomerIdentity(PRODUCTION)).toThrow(FakeInProductionError);
    expect(createCustomerIdentity(LOCAL)).toBeInstanceOf(FakeCustomerIdentity);
  });

  it.each([
    ['le service de clés', new FakeKms()],
    ['l’identité du terminal', new FakeDeviceIdentity()],
    ['l’identité du festivalier', new FakeCustomerIdentity()],
  ])('garde de démarrage : %s en production fait échouer le démarrage', (name, fake) => {
    expect(() => assertNoFakeInProduction(true, { [name]: fake })).toThrow(new RegExp(name));
    expect(() => assertNoFakeInProduction(false, { [name]: fake })).not.toThrow();
  });

  it('la garde nomme tous les faux présents et laisse passer un fournisseur réel', () => {
    const real = { identify: async () => null };
    expect(() => assertNoFakeInProduction(true, { 'le service de clés': null, 'l’identité du terminal': real })).not.toThrow();
    try {
      assertNoFakeInProduction(true, { a: new FakeKms(), b: real, c: new FakeDeviceIdentity() });
      throw new Error('aurait dû refuser');
    } catch (error) {
      expect(error).toBeInstanceOf(FakeInProductionError);
      expect((error as FakeInProductionError).names).toEqual(['a', 'c']);
    }
  });

  it('aucun réglage d’environnement ne désactive la garde', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL_APP: 'postgres://cashless_app:s@db:5432/c',
      DATABASE_URL_PLATFORM: 'postgres://cashless_platform:s@db:5432/c',
      OIDC_ISSUER: 'https://id.example',
      OIDC_AUDIENCE: 'a',
      OIDC_APPROVAL_AUDIENCE: 'b',
      OIDC_JWKS_URI: 'https://id.example/jwks.json',
      CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
      TRUST_PROXY_HOPS: '1',
      ALLOW_FAKES: '1',
      FAKE_KMS: 'true',
      DISABLE_PRODUCTION_GUARD: 'yes',
    });
    expect(() => createKms(config)).toThrow(FakeInProductionError);
    expect(() => createDeviceIdentity(config)).toThrow(FakeInProductionError);
    expect(() => createCustomerIdentity(config)).toThrow(FakeInProductionError);
  });
});
