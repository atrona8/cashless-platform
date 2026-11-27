// Aucun faux en production (règle du porteur du 13/10/2026, NFR-010) : un test par faux.
import { APP_CONFIG, loadConfig, type ExternalModes } from '../../src/config/config';
import { CustomerAccessTokens } from '../../src/customer-identity/customer-access-token';
import { createCustomerIdentity } from '../../src/customer-identity/customer-identity.module';
import { FakeCustomerIdentity } from '../../src/customer-identity/fake-customer-identity';
import { TokenCustomerIdentity } from '../../src/customer-identity/token-customer-identity';
import {
  createSmsFallbackProvider,
  createSmsPrimaryProvider,
  createWhatsAppProvider,
  FakeSmsFallbackProvider,
  FakeSmsPrimaryProvider,
  FakeWhatsAppProvider,
  OTP_SMS_FALLBACK_PROVIDER,
  OTP_SMS_PRIMARY_PROVIDER,
  OTP_WHATSAPP_PROVIDER,
} from '../../src/customer-auth/otp-providers';
import { FakeOtpSender } from '../../src/customer-auth/otp-sender';
import { createDeviceIdentity } from '../../src/device-identity/device-identity.module';
import { FakeDeviceIdentity } from '../../src/device-identity/fake-device-identity';
import { RealDeviceIdentity } from '../../src/device-identity/real-device-identity';
import { FakeKms } from '../../src/kms/fake-kms';
import { FakeSealCopy } from '../../src/sealing/fake-seal-copy';
import { createSealCopy } from '../../src/sealing/sealing.module';
import { FakeOperationProcessor } from '../../src/offline/batches/fake-operation-processor';
import { OFFLINE_OPERATION_PROCESSOR } from '../../src/offline/batches/batch.types';
import { createEntryEncryptor } from '../../src/snapshots-content/entry-encryptor';
import { PspAdapterRegistry } from '../../src/psp/psp-adapter-registry';
import { FakePspAdapter } from '../../src/psp/fake/fake-psp-adapter';
import { FakeSignalPspAdapter } from '../../src/psp/fake/fake-signal-psp-adapter';
import { FakePspSecretStore } from '../../src/psp/fake/fake-psp-secret-store';
import { PspHttpClient } from '../../src/psp/http/psp-http';
import { WavePspAdapter } from '../../src/psp/wave/wave-adapter';
import { PayDunyaPspAdapter } from '../../src/psp/paydunya/paydunya-adapter';
import { StripePspAdapter } from '../../src/psp/stripe/stripe-adapter';
import { AwsSecretsManagerStore } from '../../src/psp/aws/secrets-manager-store';
import { AwsKms } from '../../src/kms/aws/aws-kms';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { KMSClient } from '@aws-sdk/client-kms';
import { EXTERNAL_SERVICES } from '../../src/external-services/services';
import { createKms, KMS_PROVIDER } from '../../src/kms/kms.module';
import { S3Client } from '@aws-sdk/client-s3';
import { S3SealCopy } from '../../src/sealing/s3-seal-copy';
import { startFakeServer } from '../support/fake-servers/http-fake';
import { SIGN_PORT } from '../../src/kms/kms.ports';
import {
  assertNoFakeInProduction,
  assertSafeTransport,
  FakeInProductionError,
  UnsafeTransportError,
  UntriedInProductionError,
} from '../../src/kms/production-guard';
import { assertProcessIsSafe, tlsServerOptions } from '../../src/processes/bootstrap';
import {
  ATTESTATION_VERIFIER,
  DEVICE_CA,
  EDGE_CA,
  SEAL_COPY,
  TOKEN_SIGNER,
} from '../../src/security/port-tokens';
import { FakeEdgeCa } from '../../src/edge/ca/fake-edge-ca';
import { DEVICE_PRODUCTION, testTls } from '../support/tls';

const PRODUCTION = { production: true };
const LOCAL = { production: false };
/** Production avec le réglage posé EXPLICITEMENT à `fake` (la configuration le refuse déjà au chargement). */
const modes = (over: Partial<ExternalModes>): ExternalModes => ({
  psp: 'real',
  pspSecrets: 'real',
  kms: 'real',
  sealCopy: 'real',
  ...over,
});

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
    const fake = { production: true, externalModes: modes({ kms: 'fake' }) };
    expect(() => createKms(fake)).toThrow(FakeInProductionError);
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
      expect((identity as { isFake?: boolean }).isFake).toBeUndefined();
      expect(device(production, { DEVICE_IDENTITY_FAKE: '' })).toBeInstanceOf(RealDeviceIdentity);
    }
    // Une autre valeur n'est pas une demande de faux reconnue : refus, jamais de faux par erreur.
    expect(() => device(false, { DEVICE_IDENTITY_FAKE: 'true' })).toThrow(/DEVICE_IDENTITY_FAKE/);
  });

  // Identité du festivalier par jeton (10a, hors Spec Kitty) : ce n'est pas un faux ; en production, elle ignore les
  // en-têtes de test, hors production elle les admet seulement en l'absence de `Authorization`.
  const KEY = { customerAuthHmacKey: Buffer.alloc(32, 7) };
  const withHeaders = {
    'x-test-customer-id': '11111111-1111-4111-8111-111111111111',
    'x-test-operator-id': '22222222-2222-4222-8222-222222222222',
  } as Record<string, string>;
  const requestOf = (headers: Record<string, string>) =>
    ({ header: (name: string) => headers[name.toLowerCase()] }) as never;

  it('identité du festivalier : non factice en production, et les en-têtes X-Test-* y sont ignorés', async () => {
    const identity = createCustomerIdentity({ ...PRODUCTION, ...KEY });
    expect(identity).toBeInstanceOf(TokenCustomerIdentity);
    expect((identity as { isFake?: boolean }).isFake).toBeUndefined();
    expect(() => assertNoFakeInProduction(true, { festivalier: identity })).not.toThrow();
    expect(await identity.identify(requestOf(withHeaders))).toBeNull();
    // Hors production, les mêmes en-têtes sont admis (OP-N43) ; un Bearer invalide ne se replie jamais dessus.
    const local = createCustomerIdentity({ ...LOCAL, ...KEY });
    expect(await local.identify(requestOf(withHeaders))).toMatchObject({
      customerId: withHeaders['x-test-customer-id'],
    });
    expect(
      await local.identify(requestOf({ ...withHeaders, authorization: 'Bearer abc.def.ghi' })),
    ).toBeNull();
  });

  it('identité du festivalier : un jeton valide est reconnu en production', async () => {
    const identity = createCustomerIdentity({ ...PRODUCTION, ...KEY });
    const customerId = '33333333-3333-4333-8333-333333333333';
    const familyId = '44444444-4444-4444-8444-444444444444';
    const token = await new CustomerAccessTokens(KEY).sign({
      customerId,
      operatorId: withHeaders['x-test-operator-id']!,
      familyId,
    });
    expect(await identity.identify(requestOf({ authorization: `Bearer ${token}` }))).toEqual({
      customerId,
      operatorId: withHeaders['x-test-operator-id'],
      deviceRef: familyId,
    });
  });

  it.each([
    ['WhatsApp', createWhatsAppProvider, FakeWhatsAppProvider, OTP_WHATSAPP_PROVIDER],
    ['SMS (principal)', createSmsPrimaryProvider, FakeSmsPrimaryProvider, OTP_SMS_PRIMARY_PROVIDER],
    ['SMS (repli)', createSmsFallbackProvider, FakeSmsFallbackProvider, OTP_SMS_FALLBACK_PROVIDER],
  ])(
    'faux fournisseur de codes %s : construction refusée en production, garde de démarrage',
    (label, create, Fake, token) => {
      expect(() => create(PRODUCTION)).toThrow(FakeInProductionError);
      expect(create(LOCAL)).toBeInstanceOf(Fake);
      // La garde de démarrage nomme le fournisseur ; l'en-tête X-Test-Otp-Code n'est posé que si `isFake`.
      expect(() => assertProcessIsSafe(processWith(true, token, new Fake()) as never)).toThrow(
        new RegExp(`l’envoi des codes par ${label.replace(/[()]/g, '\\$&')} est un faux`),
      );
      expect(() =>
        assertProcessIsSafe(processWith(false, token, new Fake()) as never),
      ).not.toThrow();
      expect(() => assertProcessIsSafe(processWith(true, token, {}) as never)).not.toThrow();
    },
  );

  it('FakeProvider : base commune des trois faux fournisseurs, chacun refusé en production', () => {
    for (const Fake of [FakeWhatsAppProvider, FakeSmsPrimaryProvider, FakeSmsFallbackProvider]) {
      expect(Object.getPrototypeOf(Fake).name).toBe('FakeProvider');
      expect(new Fake().isFake).toBe(true);
    }
    expect(new FakeOtpSender().isFake).toBe(true);
  });

  // Copie externe des scellements (9b, WP12 ; décision du porteur : simulée jusqu'à la mission 12b).
  it('faux de la copie externe des scellements : construction refusée en production', () => {
    const fake = { production: true, externalModes: modes({ sealCopy: 'fake' }) };
    expect(() => createSealCopy(fake)).toThrow(FakeInProductionError);
    expect(() => createSealCopy(fake)).toThrow(/la copie externe des scellements/);
    expect(createSealCopy(LOCAL)).toBeInstanceOf(FakeSealCopy);
    expect((createSealCopy(LOCAL) as { isFake?: boolean }).isFake).toBe(true);
  });

  it("copie externe des scellements : la garde de démarrage nomme le faux, et rien d'autre ne passe", () => {
    expect(() =>
      assertProcessIsSafe(processWith(true, SEAL_COPY, new FakeSealCopy()) as never),
    ).toThrow(/la copie externe des scellements est un faux/);
    expect(() =>
      assertProcessIsSafe(processWith(false, SEAL_COPY, new FakeSealCopy()) as never),
    ).not.toThrow();
    // Un port réel (sans `isFake`) passe : la garde refuse le faux, pas la copie.
    expect(() => assertProcessIsSafe(processWith(true, SEAL_COPY, {}) as never)).not.toThrow();
  });

  it.each([
    ['le service de clés', new FakeKms()],
    ['la copie externe des scellements', new FakeSealCopy()],
    ['l’identité du terminal', new FakeDeviceIdentity()],
    ['l’identité du festivalier', new FakeCustomerIdentity()],
    ['les adaptateurs PSP', new PspAdapterRegistry([new FakePspAdapter('WAVE')], true)],
    ['le coffre des secrets PSP', new FakePspSecretStore()],
    // Mission 10a : l'envoyeur factice de code (FakeOtpSender) et la base commune FakeProvider des trois faux
    // fournisseurs (instanciée ici par l'un d'eux) portent `isFake` : la garde les refuse en production.
    ['l’envoi des codes, FakeOtpSender', new FakeOtpSender()],
    ['l’envoi des codes, FakeProvider', new FakeWhatsAppProvider()],
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
    // Réglage absent = réel en production : refusé tant que `kms` n'est pas dans la liste du code (jamais un faux).
    expect(() => createKms(config)).toThrow(UntriedInProductionError);
    // Copie des scellements : réglage absent = réel ; `SEAL_COPY_BUCKET` absent n'empêche pas le chargement
    // (les processus sans scellement démarrent) ; c'est la fabrique qui refuse, avant même le compartiment.
    expect(config.externalModes.sealCopy).toBe('real');
    expect(config.sealCopy.bucket).toBeNull();
    expect(() => createSealCopy(config)).toThrow(UntriedInProductionError);
    expect(() =>
      createDeviceIdentity(config, DEVICE_DEPS, { ...process.env, DEVICE_IDENTITY_FAKE: '1' }),
    ).toThrow(FakeInProductionError);
    expect((createCustomerIdentity(config) as { isFake?: boolean }).isFake).toBeUndefined();
    expect(() => createWhatsAppProvider(config)).toThrow(FakeInProductionError);
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

  it('faux de l’autorité des passerelles (FakeEdgeCa, EDGE_CA) : production refusée, nommée', async () => {
    const fake = await FakeEdgeCa.inMemory();
    expect(fake.isFake).toBe(true);
    expect(() => assertProcessIsSafe(processWith(true, EDGE_CA, fake) as never)).toThrow(
      FakeInProductionError,
    );
    expect(() => assertProcessIsSafe(processWith(true, EDGE_CA, fake) as never)).toThrow(
      /l’autorité des passerelles/,
    );
    expect(() => assertProcessIsSafe(processWith(false, EDGE_CA, fake) as never)).not.toThrow();
    expect(() => assertProcessIsSafe(processWith(true, EDGE_CA, {}) as never)).not.toThrow();
  });

  // ----- Mission hors-ligne-snapshots-lots (WP09, T040) : le signataire de snapshots -----

  // ----- Mission hors-ligne-snapshots-lots (WP21, T088) : faux ajoutés par WP11 et WP18 -----

  it('chiffreur d’entrées provisoire (RefusingEntryEncryptor) : refusé en production', () => {
    expect(() => createEntryEncryptor(PRODUCTION)).toThrow(FakeInProductionError);
    expect((createEntryEncryptor(LOCAL) as { isFake?: boolean }).isFake).toBe(true);
  });

  it('faux processeur d’opérations hors ligne (OFFLINE_OPERATION_PROCESSOR) : production refusée', () => {
    const fake = new FakeOperationProcessor(undefined as never);
    expect(fake.isFake).toBe(true);
    expect(() =>
      assertProcessIsSafe(processWith(true, OFFLINE_OPERATION_PROCESSOR, fake) as never),
    ).toThrow(/processeur d’opérations hors ligne/);
    expect(() =>
      assertProcessIsSafe(processWith(false, OFFLINE_OPERATION_PROCESSOR, fake) as never),
    ).not.toThrow();
  });

  it('signataire de snapshots : createKms({production: true}) refuse le faux (a)', () => {
    expect(() => createKms({ production: true, externalModes: modes({ kms: 'fake' }) })).toThrow(
      FakeInProductionError,
    );
    expect((createKms({ production: false }) as { isFake?: boolean }).isFake).toBe(true);
  });

  it('signataire de snapshots : un faux SIGN_PORT fait refuser la production (b), pas ailleurs (c)', () => {
    const fake = new FakeKms();
    expect(() => assertProcessIsSafe(processWith(true, SIGN_PORT, fake) as never)).toThrow(
      /le signataire de snapshots est un faux/,
    );
    expect(() => assertProcessIsSafe(processWith(false, SIGN_PORT, fake) as never)).not.toThrow();
    expect(() => assertProcessIsSafe(processWith(true, SIGN_PORT, {}) as never)).not.toThrow();
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

// ----- Mission 12b-1, WP10 : services réels non essayés (décisions D3 et D6 du porteur, 26/11/2026) -----

describe('copie externe des scellements : production × fake/real × listé/non listé', () => {
  const sealConfig = (over: object = {}) => ({
    production: true,
    externalModes: modes({}),
    aws: { region: 'eu-west-3', endpoint: null },
    sealCopy: { bucket: 'compartiment-test', retentionDays: 3650 },
    ...over,
  });

  it('production, fake posé : refus, même listé', () => {
    const config = sealConfig({ externalModes: modes({ sealCopy: 'fake' }) });
    expect(() => createSealCopy(config)).toThrow(FakeInProductionError);
    expect(() => createSealCopy(config, ['seal-copy'])).toThrow(FakeInProductionError);
  });

  it('production, réglage absent : réel par défaut, refus Untried (jamais le faux)', () => {
    const absent = { production: true };
    expect(() => createSealCopy(absent)).toThrow(UntriedInProductionError);
    expect(() => createSealCopy(absent)).not.toThrow(FakeInProductionError);
    expect(() => createSealCopy(absent)).toThrow(/seal-copy n'a pas été essayé/);
  });

  it('production, réel non listé : démarrage refusé, avec ou sans compartiment', () => {
    expect(() => createSealCopy(sealConfig())).toThrow(UntriedInProductionError);
    expect(() => createSealCopy(sealConfig())).toThrow(
      /Démarrage refusé : seal-copy n'a pas été essayé contre le vrai service/,
    );
    const noBucket = sealConfig({ sealCopy: { bucket: null, retentionDays: 3650 } });
    expect(() => createSealCopy(noBucket)).toThrow(UntriedInProductionError);
    expect(() => createSealCopy(sealConfig(), ['kms', 'psp.secrets'])).toThrow(
      UntriedInProductionError,
    );
  });

  it('production, réel listé : la copie S3 ; sans compartiment, refus de démarrer', () => {
    const copy = createSealCopy(sealConfig(), ['seal-copy']);
    expect(copy).toBeInstanceOf(S3SealCopy);
    expect(copy.isFake).toBe(false);
    const noBucket = sealConfig({ sealCopy: { bucket: null, retentionDays: 3650 } });
    expect(() => createSealCopy(noBucket, ['seal-copy'])).toThrow(/compartiment non configuré/);
  });

  it('hors production : fake par défaut, real permis avec un compartiment', () => {
    expect(createSealCopy(loadConfig({ NODE_ENV: 'test' }))).toBeInstanceOf(FakeSealCopy);
    const config = loadConfig({
      NODE_ENV: 'test',
      SEAL_COPY: 'real',
      SEAL_COPY_BUCKET: 'compartiment-test',
    });
    expect(createSealCopy(config)).toBeInstanceOf(S3SealCopy);
    expect(() => loadConfig({ NODE_ENV: 'test', SEAL_COPY: 'real' })).toThrow(/SEAL_COPY_BUCKET/);
  });

  it('serveur arrêté : la construction ne contacte rien ; l’écriture échoue sans nommer le compartiment', async () => {
    const server = await startFakeServer(() => undefined);
    const url = server.url;
    await server.close();
    const config = loadConfig({
      NODE_ENV: 'test',
      SEAL_COPY: 'real',
      SEAL_COPY_BUCKET: 'compartiment-secret-xyz',
      AWS_ENDPOINT_URL: url,
    });
    const client = new S3Client({
      region: 'eu-west-3',
      endpoint: url,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      maxAttempts: 1,
    });
    const copy = createSealCopy(config, [], client);
    const error: unknown = await copy
      .write({ kind: 'LEDGER', id: 'x', sealNo: 1 } as never, Buffer.alloc(32))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('compartiment-secret-xyz');
  });
});

describe('faux adaptateur à signal (FakeSignalPspAdapter) : refusé en production', () => {
  it.each(['WAVE', 'PAYDUNYA'] as const)('registre portant le faux à signal %s', (provider) => {
    const registry = new PspAdapterRegistry([new FakeSignalPspAdapter(provider)], true);
    expect(registry.isFake).toBe(true);
    expect(() => assertNoFakeInProduction(true, { 'les adaptateurs PSP': registry })).toThrow(
      FakeInProductionError,
    );
    expect(() => assertNoFakeInProduction(false, { x: registry })).not.toThrow();
  });
});

describe('marques des adaptateurs réels (interfaces §6) lues par la garde de démarrage', () => {
  const http = new PspHttpClient({ pspHttpTimeoutMs: 5000 });
  const cfg = loadConfig({ NODE_ENV: 'test', SEAL_COPY: 'real', SEAL_COPY_BUCKET: 'b-test' });
  const real: Array<[string, object, string]> = [
    ['Wave', new WavePspAdapter(http, cfg), 'psp.wave'],
    ['PayDunya', new PayDunyaPspAdapter(http, cfg), 'psp.paydunya'],
    ['Stripe', new StripePspAdapter(http, cfg), 'psp.stripe'],
    [
      'coffre',
      new AwsSecretsManagerStore(new SecretsManagerClient({ region: 'eu-west-3' })),
      'psp.secrets',
    ],
    ['KMS', new AwsKms(new KMSClient({ region: 'eu-west-3' })), 'kms'],
    ['copie', new S3SealCopy(new S3Client({ region: 'eu-west-3' }), cfg), 'seal-copy'],
  ];

  it.each(real)(
    '%s : isFake false et service attendu, dans EXTERNAL_SERVICES',
    (_n, adapter, service) => {
      expect((adapter as { isFake?: boolean }).isFake).toBe(false);
      expect((adapter as { service?: string }).service).toBe(service);
      expect(EXTERNAL_SERVICES as readonly string[]).toContain(service);
    },
  );

  it.each(real)(
    '%s construit directement : refusé en production s’il n’est pas listé',
    (_n, adapter, service) => {
      expect(() => assertNoFakeInProduction(true, { x: adapter })).toThrow(
        UntriedInProductionError,
      );
      expect(() =>
        assertNoFakeInProduction(true, { x: adapter }, [service as never]),
      ).not.toThrow();
      expect(() => assertNoFakeInProduction(false, { x: adapter })).not.toThrow();
    },
  );
});

describe('garde de démarrage : un service réel non listé est refusé comme un faux', () => {
  const real = { isFake: false, service: 'kms' };
  const processWith = (production: boolean, token: symbol, provider: object) => ({
    get: (wanted: unknown) => {
      if (wanted === token) return provider;
      if (wanted === APP_CONFIG) return { production };
      throw new Error('absent');
    },
  });

  it('production : un réel dont le service n’est pas dans la liste du code → UntriedInProductionError', () => {
    expect(() => assertNoFakeInProduction(true, { 'le service de clés': real })).toThrow(
      UntriedInProductionError,
    );
    expect(() =>
      assertNoFakeInProduction(true, { x: { isFake: false, service: 'psp.wave' } }),
    ).toThrow(/psp\.wave n'a pas été essayé/);
  });

  it('production : listé (liste injectée par le test, jamais la liste du code) → passe', () => {
    expect(() => assertNoFakeInProduction(true, { x: real }, ['kms'])).not.toThrow();
    expect(() => assertNoFakeInProduction(true, { x: real }, ['seal-copy'])).toThrow(
      UntriedInProductionError,
    );
  });

  it('hors production : aucun refus', () => {
    expect(() => assertNoFakeInProduction(false, { x: real })).not.toThrow();
  });

  it('un faux reste refusé d’abord, listé ou non', () => {
    expect(() =>
      assertNoFakeInProduction(true, { a: real, b: { isFake: true, service: 'kms' } }, ['kms']),
    ).toThrow(FakeInProductionError);
  });

  it('assertProcessIsSafe : le service de clés réel non listé fait refuser le processus', () => {
    const kms = createKms(
      {
        production: true,
        externalModes: modes({}),
        aws: { region: 'eu-west-3', endpoint: null },
      },
      ['sign'],
      ['kms'], // construit seulement ; la garde de démarrage relit la liste du code, vide
    );
    expect(() => assertProcessIsSafe(processWith(true, SIGN_PORT, kms) as never)).toThrow(
      UntriedInProductionError,
    );
    expect(() => assertProcessIsSafe(processWith(false, SIGN_PORT, kms) as never)).not.toThrow();
  });
});
