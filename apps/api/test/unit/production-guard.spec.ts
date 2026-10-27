// Aucun faux en production (règle du porteur du 13/10/2026, NFR-010) : un test par faux.
import { APP_CONFIG, loadConfig } from '../../src/config/config';
import { createCustomerIdentity } from '../../src/customer-identity/customer-identity.module';
import { FakeCustomerIdentity } from '../../src/customer-identity/fake-customer-identity';
import { createDeviceIdentity } from '../../src/device-identity/device-identity.module';
import { FakeDeviceIdentity } from '../../src/device-identity/fake-device-identity';
import { RealDeviceIdentity } from '../../src/device-identity/real-device-identity';
import { FakeKms } from '../../src/kms/fake-kms';
import { PspAdapterRegistry } from '../../src/psp/psp-adapter-registry';
import { FakePspAdapter } from '../../src/psp/fake/fake-psp-adapter';
import { FakePspSecretStore } from '../../src/psp/fake/fake-psp-secret-store';
import { createKms, KMS_PROVIDER } from '../../src/kms/kms.module';
import {
  assertNoFakeInProduction,
  assertSafeTransport,
  FakeInProductionError,
  UnsafeTransportError,
} from '../../src/kms/production-guard';
import { assertProcessIsSafe, tlsServerOptions } from '../../src/processes/bootstrap';
import { ATTESTATION_VERIFIER, DEVICE_CA, TOKEN_SIGNER } from '../../src/security/port-tokens';
import { DEVICE_PRODUCTION, testTls } from '../support/tls';

const PRODUCTION = { production: true };
const LOCAL = { production: false };

// Identité du terminal (mission 5a, lot WP12) : réelle par défaut ; le faux n'existe que hors
// production et sur demande explicite (DEVICE_IDENTITY_FAKE=1). Dépendances jamais appelées ici.
const DEVICE_DEPS = {
  tokens: { verify: () => Promise.reject(new Error('non appelé')) },
  directory: { findForAuthentication: () => Promise.resolve(null) },
  nonces: { consume: () => Promise.resolve() },
};
const device = (production: boolean, env: NodeJS.ProcessEnv) =>
  createDeviceIdentity({ production, deviceRequestAuthorities: ['api.example'] }, DEVICE_DEPS, env);

describe('aucun faux en production', () => {
  it('faux service de clés : construction refusée en production', () => {
    expect(() => createKms(PRODUCTION)).toThrow(FakeInProductionError);
    expect(createKms(LOCAL)).toBeInstanceOf(FakeKms);
  });

  it('faux terminal : construction refusée en production, même demandé', () => {
    expect(() => device(true, { DEVICE_IDENTITY_FAKE: '1' })).toThrow(FakeInProductionError);
    expect(device(false, { DEVICE_IDENTITY_FAKE: '1' })).toBeInstanceOf(FakeDeviceIdentity);
  });

  it('terminal : identité réelle par défaut, en production comme ailleurs (OP-N42)', () => {
    for (const production of [true, false]) {
      const identity = device(production, {});
      expect(identity).toBeInstanceOf(RealDeviceIdentity);
      expect(identity.isFake).toBeUndefined();
      expect(device(production, { DEVICE_IDENTITY_FAKE: '' })).toBeInstanceOf(RealDeviceIdentity);
    }
    // Une autre valeur n'est pas une demande de faux reconnue : refus, jamais de faux par erreur.
    expect(() => device(false, { DEVICE_IDENTITY_FAKE: 'true' })).toThrow(/DEVICE_IDENTITY_FAKE/);
  });

  it('faux festivalier : construction refusée en production', () => {
    expect(() => createCustomerIdentity(PRODUCTION)).toThrow(FakeInProductionError);
    expect(createCustomerIdentity(LOCAL)).toBeInstanceOf(FakeCustomerIdentity);
  });

  it.each([
    ['le service de clés', new FakeKms()],
    ['l’identité du terminal', new FakeDeviceIdentity()],
    ['l’identité du festivalier', new FakeCustomerIdentity()],
    ['les adaptateurs PSP', new PspAdapterRegistry([new FakePspAdapter('WAVE')], true)],
    ['le coffre des secrets PSP', new FakePspSecretStore()],
  ])('garde de démarrage : %s en production fait échouer le démarrage', (name, fake) => {
    expect(() => assertNoFakeInProduction(true, { [name]: fake })).toThrow(new RegExp(name));
    expect(() => assertNoFakeInProduction(false, { [name]: fake })).not.toThrow();
  });

  it('la garde nomme tous les faux présents et laisse passer un fournisseur réel', () => {
    const real = { identify: async () => null };
    expect(() =>
      assertNoFakeInProduction(true, {
        'le service de clés': null,
        'l’identité du terminal': real,
      }),
    ).not.toThrow();
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
      TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
      CLAIM_CODE_DOMAIN: 'pay.example.org',
      TRUST_PROXY_HOPS: '1',
      ...DEVICE_PRODUCTION,
      ALLOW_FAKES: '1',
      FAKE_KMS: 'true',
      DISABLE_PRODUCTION_GUARD: 'yes',
    });
    expect(() => createKms(config)).toThrow(FakeInProductionError);
    expect(() =>
      createDeviceIdentity(config, DEVICE_DEPS, { ...process.env, DEVICE_IDENTITY_FAKE: '1' }),
    ).toThrow(FakeInProductionError);
    expect(() => createCustomerIdentity(config)).toThrow(FakeInProductionError);
  });

  // ----- Mission identite-enrolement-terminaux (T038) : trois ports de plus, lus par la garde de démarrage -----

  /** Processus minimal : la configuration, et `provider` derrière `token` (aucun autre fournisseur). */
  const processWith = (production: boolean, token: symbol, provider: object) => ({
    get: (wanted: unknown) => {
      if (wanted === token) return provider;
      if (wanted === APP_CONFIG) return { production };
      throw new Error('absent');
    },
  });

  it.each([
    ['l’autorité des terminaux', DEVICE_CA],
    ['le signataire des jetons d’appareil', TOKEN_SIGNER],
    ['le vérificateur d’attestation', ATTESTATION_VERIFIER],
  ])('garde de démarrage : un faux de %s fait refuser la production', (name, token) => {
    const fake = { isFake: true };
    expect(() => assertProcessIsSafe(processWith(true, token, fake) as never)).toThrow(
      FakeInProductionError,
    );
    expect(() => assertProcessIsSafe(processWith(true, token, fake) as never)).toThrow(
      new RegExp(name),
    );
    expect(() => assertProcessIsSafe(processWith(false, token, fake) as never)).not.toThrow();
    // Un fournisseur réel (sans marqueur) passe ; le service de clés reste lu comme avant.
    expect(() => assertProcessIsSafe(processWith(true, token, {}) as never)).not.toThrow();
    expect(() =>
      assertProcessIsSafe(processWith(true, KMS_PROVIDER, new FakeKms()) as never),
    ).toThrow(/service de clés/);
  });

  it('transport (R-03, OP-N53) : en production avec TLS, TRUST_PROXY_HOPS > 0 refusé', () => {
    for (const hops of [1, 2, 5])
      expect(() =>
        assertSafeTransport({ production: true, tls: true, trustProxyHops: hops }),
      ).toThrow(UnsafeTransportError);
    expect(() => assertSafeTransport({ production: true, tls: true, trustProxyHops: 1 })).toThrow(
      /OP-N53.*R-03/,
    );
    expect(() =>
      assertSafeTransport({ production: true, tls: true, trustProxyHops: 0 }),
    ).not.toThrow();
  });

  it('transport : aucune écoute en clair en production ; permise hors production', () => {
    expect(() => assertSafeTransport({ production: true, tls: false, trustProxyHops: 0 })).toThrow(
      /écoute en clair interdite en production/,
    );
    expect(() =>
      assertSafeTransport({ production: false, tls: false, trustProxyHops: 2 }),
    ).not.toThrow();
    expect(() =>
      assertSafeTransport({ production: false, tls: true, trustProxyHops: 2 }),
    ).not.toThrow();
  });

  it('options TLS : TLS 1.3, certificat client demandé, jugé contre la seule autorité des terminaux', async () => {
    expect(
      tlsServerOptions({ tlsCertFile: null, tlsKeyFile: null, deviceCaCertFile: null }),
    ).toBeUndefined();
    const tls = await testTls();
    const options = tlsServerOptions(tls);
    expect(options).toMatchObject({
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.3',
    });
    expect(String(options?.ca)).toBe(tls.deviceCaCertPem);
    expect(() =>
      tlsServerOptions({
        tlsCertFile: tls.tlsCertFile,
        tlsKeyFile: tls.tlsKeyFile,
        deviceCaCertFile: null,
      }),
    ).toThrow(/DEVICE_CA_CERT_FILE manquant/);
  });
});
