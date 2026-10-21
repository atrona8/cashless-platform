// Attestation iOS App Attest (WP11, T055) : un cas nominal, puis un refus par contrôle (entrée,
// CBOR, chaîne, nonce et défi des deux clés, authData), la garde de l'environnement de
// développement (T054) et le câblage du module (routeur, `isFake` propagé, racine obligatoire et
// racine de test refusée en production). Aucun réseau, aucune base.
import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { AttestationError, type AttestationInput } from '../../../src/attestation/attestation.port';
import {
  AttestationRouter,
  createAttestationVerifier,
} from '../../../src/attestation/attestation.module';
import { iosClientDataHash } from '../../../src/attestation/enrollment-challenge';
import { FakeAttestation } from '../../../src/attestation/fake-attestation';
import {
  AAGUID_DEVELOPMENT,
  AAGUID_PRODUCTION,
  IosAppAttestVerifier,
  type IosAppAttestSettings,
} from '../../../src/attestation/ios-app-attest';
import { assertNoFakeInProduction, FakeInProductionError } from '../../../src/kms/production-guard';
import { createAndroidTestPki } from '../../support/attestation/android';
import {
  appAttestObject,
  authData,
  createIosTestPki,
  defaultAuthDataFields,
  keyPair,
  nonceExtensionValue,
  rawPoint,
  sha256,
  spki,
  TEST_IOS_BUNDLE_ID,
  TEST_IOS_TEAM_ID,
  type AppAttestOptions,
  type IosTestPki,
} from '../../support/attestation/ios';

const CODE = 'ABCDEFGHJKMN';
const SERIAL = 'TPE-IOS-0001';
const DAY = 86_400_000;

type KeyPair = Awaited<ReturnType<typeof keyPair>>;

let pki: IosTestPki;
let otherPki: IosTestPki;
let appAttestKeys: KeyPair;
let signingSpki: Buffer;
let agreementSpki: Buffer;
let otherSpki: Buffer;

beforeAll(async () => {
  pki = await createIosTestPki();
  // Mêmes sujets, autres clés : l'intermédiaire de `otherPki` porte le nom de la racine de `pki`.
  otherPki = await createIosTestPki();
  appAttestKeys = await keyPair();
  signingSpki = await spki((await keyPair()).publicKey);
  agreementSpki = await spki((await keyPair()).publicKey);
  otherSpki = await spki((await keyPair()).publicKey);
});

function verifier(settings: Partial<IosAppAttestSettings> = {}): IosAppAttestVerifier {
  return new IosAppAttestVerifier({
    roots: [pki.rootDer],
    teamId: TEST_IOS_TEAM_ID,
    bundleId: TEST_IOS_BUNDLE_ID,
    environment: 'production',
    production: false,
    ...settings,
  });
}

function clientDataHash(signing = signingSpki, agreement = agreementSpki): Buffer {
  return iosClientDataHash(CODE, SERIAL, signing, agreement);
}

async function object(options: Partial<AppAttestOptions> = {}): Promise<Buffer> {
  return appAttestObject({
    publicKey: appAttestKeys.publicKey,
    clientDataHash: clientDataHash(),
    pki,
    ...options,
  });
}

async function input(
  options: Partial<AppAttestOptions> = {},
  overrides: Partial<AttestationInput> = {},
): Promise<AttestationInput> {
  return {
    os: 'IOS',
    keyAttestationChain: [await object(options)],
    agreementAttestationChain: null,
    signingPublicKey: signingSpki,
    agreementPublicKey: agreementSpki,
    enrollmentCode: CODE,
    serial: SERIAL,
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>, reason: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AttestationError);
  expect((error as AttestationError).reason).toMatch(reason);
}

async function refusedWith(
  options: Partial<AppAttestOptions>,
  reason: RegExp,
  settings: Partial<IosAppAttestSettings> = {},
): Promise<void> {
  await refusal(verifier(settings).verify(await input(options)), reason);
}

describe('attestation iOS — cas nominal', () => {
  it('accepte un objet App Attest valide, sans niveau de sécurité', async () => {
    await expect(verifier().verify(await input())).resolves.toEqual({
      kind: 'IOS_APP_ATTEST',
      securityLevel: null,
    });
  });

  it('accepte une liste vide pour la chaîne d’accord (absente sur iOS)', async () => {
    const attestation = await input({}, { agreementAttestationChain: [] });
    await expect(verifier().verify(attestation)).resolves.toBeDefined();
  });

  it('développement (hors production) : appattestdevelop et appattest admis', async () => {
    const development = verifier({ environment: 'development' });
    await expect(
      development.verify(await input({ fields: { aaguid: AAGUID_DEVELOPMENT } })),
    ).resolves.toBeDefined();
    await expect(development.verify(await input())).resolves.toBeDefined();
  });
});

describe('attestation iOS — entrée', () => {
  it('système autre qu’iOS → refus', async () => {
    await refusal(
      verifier().verify(await input({}, { os: 'ANDROID' })),
      /ANDROID adressé au vérificateur iOS/,
    );
  });

  it('chaîne d’accord présente → refus', async () => {
    const attestation = await input({}, { agreementAttestationChain: [Buffer.from([1])] });
    await refusal(verifier().verify(attestation), /clé d’accord inattendue/);
  });

  it('zéro ou deux objets App Attest → refus', async () => {
    const one = await object();
    await refusal(verifier().verify(await input({}, { keyAttestationChain: [] })), /un seul objet/);
    await refusal(
      verifier().verify(await input({}, { keyAttestationChain: [one, one] })),
      /un seul objet/,
    );
  });

  it('clés de signature et d’accord identiques → refus', async () => {
    const attestation = await input(
      { clientDataHash: clientDataHash(signingSpki, signingSpki) },
      { agreementPublicKey: signingSpki },
    );
    await refusal(verifier().verify(attestation), /identiques/);
  });
});

describe('attestation iOS — objet CBOR', () => {
  it('objet démesuré → refus avant décodage', async () => {
    const attestation = await input({}, { keyAttestationChain: [Buffer.alloc(40_000)] });
    await refusal(verifier().verify(attestation), /trop long/);
  });

  it('CBOR illisible → refus', async () => {
    const attestation = await input({}, { keyAttestationChain: [Buffer.from([0xff, 0x00])] });
    await refusal(verifier().verify(attestation), /illisible \(CBOR\)/);
  });

  it('autre chose qu’une table → refus', async () => {
    await refusedWith({ object: () => ['fmt', 'apple-appattest'] }, /table CBOR attendue/);
  });

  it('format autre que apple-appattest → refus', async () => {
    await refusedWith(
      { object: (built) => new Map([...built, ['fmt', 'android-key']]) },
      /format ≠ apple-appattest/,
    );
  });

  it('attStmt absent → refus', async () => {
    await refusedWith(
      { object: (built) => new Map([...built].filter(([key]) => key !== 'attStmt')) },
      /attStmt absent/,
    );
  });

  it('x5c absent → refus', async () => {
    await refusedWith(
      { object: (built) => new Map([...built, ['attStmt', new Map()]]) },
      /attStmt\.x5c absent/,
    );
  });

  it('élément de x5c qui n’est pas une chaîne d’octets → refus', async () => {
    await refusedWith({ x5c: (leaf) => [leaf, 'texte'] }, /x5c\[1\] : chaîne d’octets/);
  });

  it('authData qui n’est pas une chaîne d’octets → refus', async () => {
    await refusedWith(
      { object: (built) => new Map([...built, ['authData', 'texte']]) },
      /authData : chaîne d’octets/,
    );
  });
});

describe('attestation iOS — chaîne x5c', () => {
  it('feuille seule → refus', async () => {
    await refusedWith({ x5c: (leaf) => [leaf] }, /chaîne trop courte/);
  });

  it('chaîne démesurée → refus', async () => {
    await refusedWith(
      { x5c: (leaf, intermediate) => [leaf, ...Array(5).fill(intermediate)] },
      /chaîne trop longue/,
    );
  });

  it('certificat illisible → refus', async () => {
    await refusedWith(
      { x5c: (leaf) => [leaf, new Uint8Array(Buffer.from('pas un certificat'))] },
      /certificat 1 illisible/,
    );
  });

  it('racine inconnue (autre PKI aux mêmes noms) → refus', async () => {
    await refusedWith({ pki: otherPki }, /racine inconnue/);
  });

  it('feuille d’un autre émetteur → refus', async () => {
    await refusedWith(
      { leafIssuer: 'CN=Autre autorité' },
      /certificat 0 : émetteur différent du sujet du suivant/,
    );
  });

  it('feuille signée par une autre clé → refus', async () => {
    const forger = await keyPair();
    await refusedWith({ leafSigningKey: forger.privateKey }, /certificat 0 : signature invalide/);
  });

  it('intermédiaire qui n’est pas une autorité → refus', async () => {
    const notCa = await createIosTestPki({ intermediateCa: false });
    await refusedWith({ pki: notCa }, /certificat 1 : pas une autorité/, {
      roots: [notCa.rootDer],
    });
  });

  it('feuille expirée ou pas encore valide → refus', async () => {
    await refusedWith(
      { leafNotBefore: new Date(Date.now() - 3 * DAY), leafNotAfter: new Date(Date.now() - DAY) },
      /certificat 0 hors de sa période/,
    );
    await refusedWith(
      { leafNotBefore: new Date(Date.now() + DAY), leafNotAfter: new Date(Date.now() + 2 * DAY) },
      /certificat 0 hors de sa période/,
    );
  });

  it('racine expirée → refus', async () => {
    const short = await createIosTestPki({ rootNotAfter: new Date(Date.now() + DAY) });
    const now = () => new Date(Date.now() + 2 * DAY);
    await refusedWith({ pki: short }, /certificat 2 hors de sa période/, {
      roots: [short.rootDer],
      now,
    });
  });

  it('feuille sans extension de nonce, ou avec deux → refus', async () => {
    await refusedWith({ nonceExtension: null }, /feuille sans extension de nonce unique/);
    await refusedWith({ duplicateNonceExtension: true }, /feuille sans extension de nonce unique/);
  });

  it('extension de nonce dans l’intermédiaire → refus', async () => {
    await refusedWith({ nonceInIntermediate: true }, /extension de nonce hors de la feuille/);
  });

  it('clé de la feuille autre que P-256 → refus', async () => {
    const p384 = await keyPair('P-384');
    await refusedWith({ publicKey: p384.publicKey }, /autre que P-256/);
  });
});

describe('attestation iOS — nonce et défi d’enrôlement (R-08)', () => {
  it('nonce faux → refus', async () => {
    await refusedWith({ nonce: Buffer.alloc(32, 1) }, /nonce différent/);
  });

  it('extension de nonce mal encodée (nonce juste, DER autre) → refus', async () => {
    const data = authData(defaultAuthDataFields(), sha256(await rawPoint(appAttestKeys.publicKey)));
    const nonce = sha256(data, clientDataHash());
    await refusedWith(
      { nonceExtension: Buffer.concat([Buffer.from('0420', 'hex'), nonce]) },
      /nonce différent/,
    );
    expect(nonceExtensionValue(nonce).subarray(6)).toEqual(nonce);
  });

  it('clientDataHash d’une autre clé de signature → refus (substitution de clé)', async () => {
    await refusedWith(
      { clientDataHash: clientDataHash(otherSpki, agreementSpki) },
      /nonce différent/,
    );
  });

  it('clientDataHash d’une autre clé d’accord → refus (substitution de clé)', async () => {
    await refusedWith(
      { clientDataHash: clientDataHash(signingSpki, otherSpki) },
      /nonce différent/,
    );
  });

  it('clés annoncées substituées après l’attestation → refus', async () => {
    const attestation = await input({}, { signingPublicKey: otherSpki });
    await refusal(verifier().verify(attestation), /nonce différent/);
    const swapped = await input({}, { agreementPublicKey: otherSpki });
    await refusal(verifier().verify(swapped), /nonce différent/);
  });

  it('autre code d’enrôlement ou autre serial → refus', async () => {
    await refusal(
      verifier().verify(await input({}, { enrollmentCode: 'ABCDEFGHJKMP' })),
      /nonce différent/,
    );
    await refusal(
      verifier().verify(await input({}, { serial: 'TPE-IOS-0002' })),
      /nonce différent/,
    );
  });
});

describe('attestation iOS — authData', () => {
  it('rpIdHash d’une autre app ou d’une autre équipe → refus', async () => {
    await refusedWith(
      { fields: { rpId: `${TEST_IOS_TEAM_ID}.org.autre.app` } },
      /rpIdHash d’une autre application/,
    );
    await refusedWith(
      { fields: { rpId: `AUTRETEAM1.${TEST_IOS_BUNDLE_ID}` } },
      /rpIdHash d’une autre application/,
    );
  });

  it('drapeau « attested credential data » absent → refus', async () => {
    await refusedWith({ fields: { flags: 0x01 } }, /sans données de clé attestée/);
  });

  it('compteur ≠ 0 → refus', async () => {
    await refusedWith({ fields: { counter: 1 } }, /compteur ≠ 0/);
  });

  it('aaguid de développement en environnement production → refus', async () => {
    await refusedWith({ fields: { aaguid: AAGUID_DEVELOPMENT } }, /aaguid de développement refusé/);
  });

  it('aaguid inconnu → refus, même en développement', async () => {
    const unknown = Buffer.from('appattestothers!', 'ascii');
    await refusedWith({ fields: { aaguid: unknown } }, /aaguid inconnu/);
    await refusedWith({ fields: { aaguid: unknown } }, /aaguid inconnu/, {
      environment: 'development',
    });
  });

  it('credentialId faux → refus', async () => {
    await refusedWith(
      { fields: { credentialId: sha256(Buffer.from('autre clé')) } },
      /credentialId différent/,
    );
  });

  it('authData tronqué (en-tête, ou credentialId plus long que l’authData) → refus', async () => {
    await refusedWith({ rawAuthData: Buffer.alloc(54) }, /authData tronqué/);
    const data = authData(
      { ...defaultAuthDataFields(), credentialPublicKey: Buffer.alloc(0) },
      sha256(await rawPoint(appAttestKeys.publicKey)),
    );
    data.writeUInt16BE(40, 53); // annonce 40 octets, 32 présents
    await refusedWith({ rawAuthData: data }, /authData tronqué/);
  });
});

describe('attestation iOS — réglages (T054)', () => {
  it('environnement de développement en production : construction refusée', () => {
    expect(() => verifier({ production: true, environment: 'development' })).toThrow(
      /« production » exigé en production/,
    );
    expect(() => verifier({ production: true, environment: 'production' })).not.toThrow();
  });

  it('aucune racine : construction refusée', () => {
    expect(() => verifier({ roots: [] })).toThrow(/aucune racine/);
  });

  it('aaguid de production : « appattest » suivi de sept octets nuls', () => {
    expect(AAGUID_PRODUCTION).toEqual(Buffer.from('617070617474657374' + '00'.repeat(7), 'hex'));
    expect(AAGUID_DEVELOPMENT).toHaveLength(16);
  });
});

describe('attestation iOS — module, routeur et garde de production', () => {
  const base = {
    androidAppPackage: 'org.cashless.terminal',
    androidAppSigningDigests: ['00'.repeat(32)],
    androidMinPatchLevel: 202201,
    iosTeamId: TEST_IOS_TEAM_ID,
    iosBundleId: TEST_IOS_BUNDLE_ID,
    iosAppAttestEnvironment: 'production' as const,
  };
  const revocation = { revocationSource: async () => ({ entries: {} }) };
  let dir: string;
  let androidRoots: string;
  let iosRoot: string;
  let neutralRoot: string;
  let neutralRoot2: string;

  /** Racine sans la marque de test (pour atteindre les contrôles de production qui suivent). */
  async function neutralRootPem(name: string): Promise<string> {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name,
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + DAY),
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      keys,
      extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
    });
    return cert.toString('pem');
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cashless-attestation-ios-'));
    androidRoots = join(dir, 'android.pem');
    iosRoot = join(dir, 'ios.pem');
    neutralRoot = join(dir, 'neutral-android.pem');
    neutralRoot2 = join(dir, 'neutral-ios.pem');
    writeFileSync(androidRoots, (await createAndroidTestPki()).rootPem);
    writeFileSync(iosRoot, pki.rootPem);
    writeFileSync(neutralRoot, await neutralRootPem('CN=Racine neutre Android'));
    writeFileSync(neutralRoot2, await neutralRootPem('CN=Racine neutre Apple'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('avec la racine Apple : le routeur vérifie iOS (pas un faux)', async () => {
    const router = createAttestationVerifier(
      {
        ...base,
        production: false,
        androidAttestationRoots: androidRoots,
        iosAppAttestRoot: iosRoot,
      },
      revocation,
    );
    expect(router).toBeInstanceOf(AttestationRouter);
    expect(router.isFake).toBeUndefined();
    await expect(router.verify(await input())).resolves.toEqual({
      kind: 'IOS_APP_ATTEST',
      securityLevel: null,
    });
    await refusal(router.verify(await input({ fields: { counter: 1 } })), /compteur ≠ 0/);
  });

  it('sans racine Apple hors production : iOS refusé', async () => {
    const router = createAttestationVerifier(
      { ...base, production: false, androidAttestationRoots: androidRoots, iosAppAttestRoot: null },
      revocation,
    );
    await refusal(router.verify(await input()), /IOS non pris en charge/);
  });

  it('le routeur propage isFake : un faux iOS ou Android fait refuser la production', () => {
    const real = verifier();
    const fakeIos = new AttestationRouter(real, new FakeAttestation());
    const fakeAndroid = new AttestationRouter(new FakeAttestation(), real);
    expect(fakeIos.isFake).toBe(true);
    expect(fakeAndroid.isFake).toBe(true);
    for (const router of [fakeIos, fakeAndroid])
      expect(() =>
        assertNoFakeInProduction(true, { 'le vérificateur d’attestation': router }),
      ).toThrow(FakeInProductionError);
    const genuine = new AttestationRouter(real, real);
    expect(genuine.isFake).toBeUndefined();
    expect(() =>
      assertNoFakeInProduction(true, { 'le vérificateur d’attestation': genuine }),
    ).not.toThrow();
  });

  it('en production : racine Apple obligatoire', () => {
    expect(() =>
      createAttestationVerifier(
        { ...base, production: true, androidAttestationRoots: neutralRoot, iosAppAttestRoot: null },
        revocation,
      ),
    ).toThrow(/IOS_APP_ATTEST_ROOT manquant/);
  });

  it('en production : une racine Apple de test fait refuser le démarrage', () => {
    expect(() =>
      createAttestationVerifier(
        {
          ...base,
          production: true,
          androidAttestationRoots: neutralRoot,
          iosAppAttestRoot: iosRoot,
        },
        revocation,
      ),
    ).toThrow(/IOS_APP_ATTEST_ROOT : racine d’attestation de test interdite en production/);
  });

  it('en production : environnement de développement refusé au niveau du vérificateur', () => {
    const production = {
      ...base,
      production: true,
      androidAttestationRoots: neutralRoot,
      iosAppAttestRoot: neutralRoot2,
    };
    expect(() =>
      createAttestationVerifier(
        { ...production, iosAppAttestEnvironment: 'development' },
        revocation,
      ),
    ).toThrow(/« production » exigé en production/);
    const router = createAttestationVerifier(production, revocation);
    expect(router.isFake).toBeUndefined();
  });
});
