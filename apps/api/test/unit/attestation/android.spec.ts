// Attestation Android (WP10, T051) : un cas nominal, puis un refus par contrôle de T047 (chaîne), T048 (KeyDescription)
// et T049 (liste de révocation) ; câblage du module (aucun faux ni racine de test en production). Aucun réseau, aucune
// base : la liste de révocation vient d'une source injectée, la PKI de test est générée à l'exécution.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecurityLevel, VerifiedBootState } from '@peculiar/asn1-android';
import {
  AndroidKeyAttestationVerifier,
  KM_PURPOSE_SIGN,
} from '../../../src/attestation/android-key-attestation';
import { AttestationError, type AttestationInput } from '../../../src/attestation/attestation.port';
import {
  AttestationRouter,
  createAttestationVerifier,
} from '../../../src/attestation/attestation.module';
import {
  androidAgreeChallenge,
  androidSignChallenge,
} from '../../../src/attestation/enrollment-challenge';
import { FakeAttestation } from '../../../src/attestation/fake-attestation';
import {
  GoogleRevocationCache,
  normalizeSerial,
  parseRevocationList,
} from '../../../src/attestation/google-revocation-cache';
import { assertNoFakeInProduction, FakeInProductionError } from '../../../src/kms/production-guard';
import {
  androidAttestationChain,
  attestationLeaf,
  createAndroidTestPki,
  keyDescriptionExtension,
  p256KeyPair,
  spki,
  TEST_ANDROID_PACKAGE,
  TEST_ANDROID_SIGNING_DIGEST,
  TEST_LEAF_SUBJECT,
  type AndroidTestPki,
  type ChainOptions,
  type KeyDescriptionFields,
} from '../../support/attestation/android';

const CODE = 'ABCDEFGHJKMN';
const SERIAL = 'TPE-0001';
const MIN_PATCH = 202201;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type KeyPair = Awaited<ReturnType<typeof p256KeyPair>>;

let pki: AndroidTestPki;
let otherPki: AndroidTestPki;
let signingKeys: KeyPair;
let agreementKeys: KeyPair;
let signingSpki: Buffer;
let agreementSpki: Buffer;

beforeAll(async () => {
  pki = await createAndroidTestPki();
  // Autre sujet d'intermédiaire : une feuille de `otherPki` a un émetteur inconnu de `pki`.
  otherPki = await createAndroidTestPki('CN=Cashless TEST Android attestation intermediate B');
  signingKeys = await p256KeyPair();
  agreementKeys = await p256KeyPair();
  signingSpki = await spki(signingKeys.publicKey);
  agreementSpki = await spki(agreementKeys.publicKey);
});

function cache(entries: Record<string, { status: string }> = {}): GoogleRevocationCache {
  return new GoogleRevocationCache({ source: async () => ({ entries }) });
}

function verifier(
  options: { revocation?: GoogleRevocationCache; minPatchLevel?: number } = {},
): AndroidKeyAttestationVerifier {
  return new AndroidKeyAttestationVerifier({
    roots: [pki.rootDer],
    packageName: TEST_ANDROID_PACKAGE,
    signingDigests: [TEST_ANDROID_SIGNING_DIGEST.toString('hex')],
    minPatchLevel: options.minPatchLevel ?? MIN_PATCH,
    revocation: options.revocation ?? cache(),
  });
}

interface InputOptions {
  signing?: Partial<ChainOptions>;
  agreement?: Partial<ChainOptions>;
  signingPki?: AndroidTestPki;
  agreementPki?: AndroidTestPki;
}

async function input(options: InputOptions = {}): Promise<AttestationInput> {
  const keyAttestationChain = await androidAttestationChain(options.signingPki ?? pki, {
    publicKey: signingKeys.publicKey,
    purpose: 'SIGN',
    challenge: androidSignChallenge(CODE, SERIAL, agreementSpki),
    ...options.signing,
  });
  const agreementAttestationChain = await androidAttestationChain(options.agreementPki ?? pki, {
    publicKey: agreementKeys.publicKey,
    purpose: 'AGREE_KEY',
    challenge: androidAgreeChallenge(CODE, SERIAL),
    ...options.agreement,
  });
  return {
    os: 'ANDROID',
    keyAttestationChain,
    agreementAttestationChain,
    signingPublicKey: signingSpki,
    agreementPublicKey: agreementSpki,
    enrollmentCode: CODE,
    serial: SERIAL,
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

/** Refus quand le champ `fields` est posé sur la clé `key`. */
async function refusedWith(
  key: 'signing' | 'agreement',
  fields: Partial<KeyDescriptionFields>,
  reason: RegExp,
  options: { minPatchLevel?: number } = {},
): Promise<void> {
  await refusal(verifier(options).verify(await input({ [key]: { fields } })), reason);
}

describe('attestation Android — cas nominal', () => {
  it('accepte les deux chaînes valides (TEE) et rend le niveau', async () => {
    await expect(verifier().verify(await input())).resolves.toEqual({
      kind: 'ANDROID_KEY_ATTESTATION',
      securityLevel: 'TRUSTED_ENVIRONMENT',
    });
  });

  it('rend STRONGBOX seulement si les deux clés sont en StrongBox', async () => {
    const strongBox = {
      attestationSecurityLevel: SecurityLevel.strongBox,
      keymasterSecurityLevel: SecurityLevel.strongBox,
    };
    await expect(
      verifier().verify(
        await input({ signing: { fields: strongBox }, agreement: { fields: strongBox } }),
      ),
    ).resolves.toEqual({ kind: 'ANDROID_KEY_ATTESTATION', securityLevel: 'STRONGBOX' });
    await expect(
      verifier().verify(await input({ signing: { fields: strongBox } })),
    ).resolves.toEqual({ kind: 'ANDROID_KEY_ATTESTATION', securityLevel: 'TRUSTED_ENVIRONMENT' });
  });

  it('vérifie chaque clé avec sa propre chaîne : chaînes inversées refusées', async () => {
    const ok = await input();
    await refusal(
      verifier().verify({
        ...ok,
        keyAttestationChain: ok.agreementAttestationChain!,
        agreementAttestationChain: ok.keyAttestationChain,
      }),
      /clé signature/,
    );
  });

  it('exige la chaîne de la clé d’accord (Android 12+)', async () => {
    await refusal(
      verifier().verify({ ...(await input()), agreementAttestationChain: null }),
      /accord : chaîne d’attestation absente/,
    );
  });

  it('refuse deux chaînes valides venant de deux appareils (rootOfTrust différent)', async () => {
    const otherDevice = { verifiedBootKey: Buffer.alloc(32, 8) };
    await refusal(
      verifier().verify(await input({ agreement: { fields: otherDevice } })),
      /^clés de signature et d’accord attestées par deux appareils différents$/,
    );
    // Même verifiedBootKey, verifiedBootHash différent, puis absent d'une seule chaîne.
    for (const verifiedBootHash of [Buffer.alloc(32, 10), null])
      await refusal(
        verifier().verify(await input({ signing: { fields: { verifiedBootHash } } })),
        /^clés de signature et d’accord attestées par deux appareils différents$/,
      );
  });

  it('accepte deux chaînes du même appareil sans verifiedBootHash', async () => {
    const noHash = { verifiedBootHash: null };
    await expect(
      verifier().verify(
        await input({ signing: { fields: noHash }, agreement: { fields: noHash } }),
      ),
    ).resolves.toBeDefined();
  });

  it('refuse un autre système et deux clés identiques', async () => {
    const ok = await input();
    await refusal(verifier().verify({ ...ok, os: 'IOS' }), /système IOS/);
    await refusal(
      verifier().verify({ ...ok, agreementPublicKey: ok.signingPublicKey }),
      /identiques/,
    );
  });
});

describe('attestation Android — chaîne (T047)', () => {
  it('chaîne cassée : émetteur différent du sujet du suivant', async () => {
    const ok = await input();
    const foreign = await input({ signingPki: otherPki });
    await refusal(
      verifier().verify({
        ...ok,
        keyAttestationChain: [foreign.keyAttestationChain[0]!, ...ok.keyAttestationChain.slice(1)],
      }),
      /^clé signature : certificat 0 : émetteur différent du sujet du suivant$/,
    );
  });

  it('chaîne cassée : signature invalide (même sujet, autre clé)', async () => {
    const forged = await createAndroidTestPki();
    // Intermédiaire de même sujet mais d'une autre clé : l'émetteur concorde, la signature non.
    const chain = await androidAttestationChain(
      { ...pki, intermediateKeys: forged.intermediateKeys },
      {
        publicKey: signingKeys.publicKey,
        purpose: 'SIGN',
        challenge: androidSignChallenge(CODE, SERIAL, agreementSpki),
      },
    );
    await refusal(
      verifier().verify({ ...(await input()), keyAttestationChain: chain }),
      /certificat 0 : signature invalide/,
    );
  });

  it('racine inconnue', async () => {
    await refusal(verifier().verify(await input({ signingPki: otherPki })), /racine inconnue/);
  });

  it('chaîne réduite à la feuille', async () => {
    const ok = await input();
    await refusal(
      verifier().verify({ ...ok, keyAttestationChain: ok.keyAttestationChain.slice(0, 1) }),
      /trop courte/,
    );
  });

  it('basicConstraints : un émetteur qui n’est pas une autorité est refusé', async () => {
    await refusal(
      verifier().verify(await input({ signing: { intermediate: { ca: false } } })),
      /^clé signature : certificat 1 : pas une autorité \(basicConstraints\)$/,
    );
  });

  it('basicConstraints : feuille forgée signée par une feuille attestée, refusée', async () => {
    // Attaque connue : la clé SIGN, attestée et authentique, signe une feuille portant une
    // KeyDescription forgée pour une clé de l'attaquant.
    // Chaîne : [feuille forgée, feuille attestée, intermédiaire, racine].
    const attested = (await input()).keyAttestationChain;
    const attackerKeys = await p256KeyPair();
    const forged = await attestationLeaf({
      issuer: TEST_LEAF_SUBJECT,
      signingKey: signingKeys.privateKey,
      publicKey: attackerKeys.publicKey,
      keyDescription: keyDescriptionExtension(
        'SIGN',
        androidSignChallenge(CODE, SERIAL, agreementSpki),
      ),
    });
    // Motif strict : sans le contrôle basicConstraints, le refus viendrait d'un autre contrôle.
    await refusal(
      verifier().verify({
        ...(await input()),
        signingPublicKey: await spki(attackerKeys.publicKey),
        keyAttestationChain: [Buffer.from(forged.rawData), ...attested],
      }),
      /^clé signature : certificat 1 : pas une autorité \(basicConstraints\)$/,
    );
  });

  it('extension KeyDescription dans un intermédiaire', async () => {
    await refusal(
      verifier().verify(await input({ signing: { keyDescriptionInIntermediate: true } })),
      /hors de la feuille/,
    );
  });

  it('feuille expirée', async () => {
    await refusal(
      verifier().verify(
        await input({ agreement: { leafNotAfter: new Date(Date.now() - 60_000) } }),
      ),
      /accord : certificat 0 hors de sa période/,
    );
  });

  it('feuille pas encore valide (notBefore dans le futur)', async () => {
    await refusal(
      verifier().verify(await input({ signing: { leafNotBefore: new Date(Date.now() + HOUR) } })),
      /^clé signature : certificat 0 hors de sa période de validité$/,
    );
  });

  it('intermédiaire expiré', async () => {
    const expired = {
      notBefore: new Date(Date.now() - 2 * DAY),
      notAfter: new Date(Date.now() - 60_000),
    };
    await refusal(
      verifier().verify(await input({ agreement: { intermediate: expired } })),
      /^clé accord : certificat 1 hors de sa période de validité$/,
    );
  });

  it('certificat illisible', async () => {
    const ok = await input();
    await refusal(
      verifier().verify({
        ...ok,
        keyAttestationChain: [Buffer.from('pas un certificat'), ...ok.keyAttestationChain.slice(1)],
      }),
      /illisible/,
    );
  });
});

describe('attestation Android — KeyDescription (T048)', () => {
  it('attestationVersion 4 (Keymaster 4.1, avant Android 12)', async () => {
    await refusedWith('signing', { attestationVersion: 4 }, /attestationVersion 4/);
  });

  it('niveau Software (attestation, puis Keymaster)', async () => {
    await refusedWith(
      'signing',
      { attestationSecurityLevel: SecurityLevel.software },
      /niveau de sécurité logiciel/,
    );
    await refusedWith(
      'agreement',
      { keymasterSecurityLevel: SecurityLevel.software },
      /niveau de sécurité logiciel/,
    );
  });

  it('défi faux (signature et accord)', async () => {
    await refusedWith('signing', { challenge: androidAgreeChallenge(CODE, SERIAL) }, /défi/);
    await refusedWith('agreement', { challenge: androidAgreeChallenge(CODE, 'TPE-0002') }, /défi/);
  });

  it('origin = IMPORTED', async () => {
    await refusedWith('signing', { origin: 2 }, /origin/);
  });

  it('purpose absent, ou SIGN pour la clé d’accord', async () => {
    await refusedWith('signing', { purpose: null }, /purpose 2 absent/);
    await refusedWith('agreement', { purpose: [KM_PURPOSE_SIGN] }, /purpose 6 absent/);
  });

  it('algorithme autre que EC', async () => {
    await refusedWith('signing', { algorithm: 1 }, /algorithm/);
  });

  it('courbe autre que P-256', async () => {
    await refusedWith('signing', { ecCurve: 2 }, /ecCurve/);
  });

  it('rootOfTrust absent', async () => {
    await refusedWith('signing', { rootOfTrust: null }, /rootOfTrust absent/);
  });

  it('appareil déverrouillé', async () => {
    await refusedWith('signing', { deviceLocked: false }, /déverrouillé/);
  });

  it('démarrage non vérifié', async () => {
    await refusedWith(
      'agreement',
      { verifiedBootState: VerifiedBootState.unverified },
      /démarrage non vérifié/,
    );
  });

  it('correctif trop ancien (système, fournisseur, démarrage) ou absent', async () => {
    await refusedWith('signing', { osPatchLevel: 202112 }, /osPatchLevel 202112 trop ancien/);
    await refusedWith('signing', { vendorPatchLevel: 20211231 }, /vendorPatchLevel 202112/);
    await refusedWith('agreement', { bootPatchLevel: 20211201 }, /bootPatchLevel 202112/);
    await refusedWith('signing', { bootPatchLevel: null }, /bootPatchLevel absent/);
    // Seuil réglable : le même appareil passe avec un seuil plus bas.
    await expect(
      verifier({ minPatchLevel: 202101 }).verify(
        await input({ signing: { fields: { osPatchLevel: 202112 } } }),
      ),
    ).resolves.toMatchObject({ kind: 'ANDROID_KEY_ATTESTATION' });
  });

  it('deux paquets', async () => {
    await refusedWith(
      'signing',
      { packages: [TEST_ANDROID_PACKAGE, 'org.autre.app'] },
      /un seul paquet/,
    );
  });

  it('paquet inattendu', async () => {
    await refusedWith('signing', { packages: ['org.autre.app'] }, /paquet org.autre.app/);
  });

  it('empreinte de signature inconnue (même accompagnée d’une connue)', async () => {
    await refusedWith(
      'signing',
      { signatureDigests: [TEST_ANDROID_SIGNING_DIGEST, Buffer.alloc(32, 1)] },
      /empreinte de signature/,
    );
  });

  it('autorisations dans softwareEnforced seulement : refusé (jamais lu)', async () => {
    await refusedWith('signing', { inSoftwareList: true }, /origin/);
  });

  it('clé de la feuille différente de la clé annoncée', async () => {
    const other = await p256KeyPair();
    await refusal(
      verifier().verify(await input({ agreement: { publicKey: other.publicKey } })),
      /accord : clé de la feuille différente/,
    );
  });
});

describe('attestation Android — borne OP-N67 / ADR-110 (attestationApplicationId seul lu dans softwareEnforced)', () => {
  it('borne OP-N67 : accepte attestationApplicationId dans softwareEnforced seulement (cas nominal)', async () => {
    await expect(
      verifier().verify(
        await input({
          signing: { fields: { applicationIdIn: 'software' } },
          agreement: { fields: { applicationIdIn: 'software' } },
        }),
      ),
    ).resolves.toMatchObject({ kind: 'ANDROID_KEY_ATTESTATION' });
  });

  it('borne OP-N67 : accepte attestationApplicationId dans la liste matérielle, ou cohérent dans les deux', async () => {
    await expect(
      verifier().verify(await input({ signing: { fields: { applicationIdIn: 'hardware' } } })),
    ).resolves.toMatchObject({ kind: 'ANDROID_KEY_ATTESTATION' });
    await expect(
      verifier().verify(await input({ signing: { fields: { applicationIdIn: 'both' } } })),
    ).resolves.toMatchObject({ kind: 'ANDROID_KEY_ATTESTATION' });
  });

  it('borne OP-N67 : refuse attestationApplicationId incohérent entre les deux listes', async () => {
    await refusedWith(
      'signing',
      { applicationIdIn: 'both', hardwarePackages: ['org.autre.app'] },
      /incohérent/,
    );
  });

  it('borne OP-N67 : refuse attestationApplicationId absent des deux listes', async () => {
    await refusedWith('signing', { applicationIdIn: 'none' }, /attestationApplicationId absent/);
    await refusedWith('agreement', { applicationIdIn: 'none' }, /attestationApplicationId absent/);
  });

  it('borne OP-N67 : refuse un mauvais paquet ou une mauvaise empreinte dans softwareEnforced', async () => {
    await refusedWith(
      'signing',
      { applicationIdIn: 'software', packages: ['org.autre.app'] },
      /paquet org.autre.app/,
    );
    await refusedWith(
      'agreement',
      { applicationIdIn: 'software', signatureDigests: [Buffer.alloc(32, 1)] },
      /empreinte de signature/,
    );
  });

  it('borne OP-N67 : refuse rootOfTrust (deviceLocked, verifiedBootState) présent seulement dans softwareEnforced', async () => {
    await refusedWith('signing', { rootOfTrustInSoftwareList: true }, /rootOfTrust absent/);
    await refusedWith('agreement', { rootOfTrustInSoftwareList: true }, /rootOfTrust absent/);
  });

  it('borne OP-N67 : refuse toutes les autres autorisations présentes seulement dans softwareEnforced', async () => {
    await refusedWith('signing', { inSoftwareList: true }, /origin/);
  });

  it('borne OP-N67 : le code ne lit softwareEnforced que pour attestationApplicationId', () => {
    const source = readFileSync(
      join(__dirname, '../../../src/attestation/android-key-attestation.ts'),
      'utf8',
    );
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
      .join('\n');
    const reads = [...code.matchAll(/softwareEnforced\s*(\??\.\s*\w+)?/g)].map((m) => m[0]);
    expect(reads).toEqual(['softwareEnforced.attestationApplicationId']);
  });
});

describe('attestation Android — liste de révocation (T049)', () => {
  it('numéro de la feuille révoqué', async () => {
    const attestation = await input({ signing: { leafSerial: '00ab12' } });
    await refusal(
      verifier({ revocation: cache({ ab12: { status: 'REVOKED' } }) }).verify(attestation),
      /ab12 : statut REVOKED/,
    );
  });

  it('numéro suspendu (clé de la liste en majuscules, zéros de tête)', async () => {
    const attestation = await input({ agreement: { leafSerial: '7f01' } });
    await refusal(
      verifier({ revocation: cache({ '007F01': { status: 'SUSPENDED' } }) }).verify(attestation),
      /7f01 : statut SUSPENDED/,
    );
  });

  it('intermédiaire révoqué', async () => {
    const intermediateSerial = pki.intermediateCert.serialNumber;
    await refusal(
      verifier({
        revocation: cache({ [intermediateSerial]: { status: 'REVOKED' } }),
      }).verify(await input()),
      /statut REVOKED/,
    );
  });

  it('cache périmé : plus de 24 h sans rafraîchissement réussi → refus', async () => {
    let now = Date.parse('2026-10-19T10:00:00Z');
    let available = true;
    const revocation = new GoogleRevocationCache({
      now: () => now,
      source: async () => {
        if (!available) throw new Error('réseau');
        return { entries: {} };
      },
    });
    const attestation = await input();
    await expect(verifier({ revocation }).verify(attestation)).resolves.toBeDefined();
    available = false;
    now += 23 * HOUR; // rafraîchissement échoué, liste de 23 h : encore acceptée
    await expect(verifier({ revocation }).verify(attestation)).resolves.toBeDefined();
    now += 2 * HOUR; // 25 h
    await refusal(verifier({ revocation }).verify(attestation), /périmée/);
    available = true; // un rafraîchissement réussi rouvre
    await expect(verifier({ revocation }).verify(attestation)).resolves.toBeDefined();
  });

  it('horloge qui recule : liste rafraîchie, refusée si le rafraîchissement échoue', async () => {
    let now = Date.parse('2026-10-19T10:00:00Z');
    let available = true;
    const revocation = new GoogleRevocationCache({
      now: () => now,
      source: async () => {
        if (!available) throw new Error('réseau');
        return { entries: {} };
      },
    });
    await expect(revocation.assertNotRevoked(['1'])).resolves.toBeUndefined();
    available = false;
    now -= 48 * HOUR; // âge négatif : ne prouve pas que la liste est fraîche
    await refusal(revocation.assertNotRevoked(['1']), /horloge antérieure au chargement/);
    available = true; // un rafraîchissement réussi rouvre
    await expect(revocation.assertNotRevoked(['1'])).resolves.toBeUndefined();
  });

  it('aucune liste chargée → refus (échec fermé)', async () => {
    const revocation = new GoogleRevocationCache({
      source: async () => {
        throw new Error('réseau');
      },
    });
    await refusal(verifier({ revocation }).verify(await input()), /indisponible/);
  });

  it('une réponse illisible ne remplace pas la liste valide', async () => {
    let body: unknown = { entries: { ab: { status: 'REVOKED' } } };
    let now = 0;
    const revocation = new GoogleRevocationCache({ now: () => now, source: async () => body });
    await expect(revocation.refresh()).resolves.toBe(true);
    body = { autre: true };
    now += 2 * HOUR;
    await expect(revocation.refresh()).resolves.toBe(false);
    await refusal(revocation.assertNotRevoked(['AB']), /statut REVOKED/);
  });

  it('statut inconnu : refusé (échec fermé) ; normalisation des numéros', () => {
    expect(parseRevocationList({ entries: { '0A': { status: 'AUTRE' } } }).get('a')).toBe('AUTRE');
    expect(() => parseRevocationList({ entries: { a: {} } })).toThrow(/statut absent/);
    expect(() => parseRevocationList([])).toThrow(/entries/);
    expect(normalizeSerial('000F')).toBe('f');
    expect(normalizeSerial('00')).toBe('0');
  });
});

describe('attestation — module et garde de production', () => {
  const base = {
    androidAppPackage: TEST_ANDROID_PACKAGE,
    androidAppSigningDigests: [TEST_ANDROID_SIGNING_DIGEST.toString('hex')],
    androidMinPatchLevel: MIN_PATCH,
    // Réglages iOS (WP11) : sans racine Apple, iOS reste refusé ici (racine posée : ios.spec.ts).
    iosAppAttestRoot: null,
    iosTeamId: 'TESTTEAM01',
    iosBundleId: 'org.cashless.terminal',
    iosAppAttestEnvironment: 'production' as const,
  };
  let dir: string;
  let rootsFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cashless-attestation-'));
    rootsFile = join(dir, 'roots.pem');
    writeFileSync(rootsFile, pki.rootPem);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sans racines hors production : faux vérificateur, refusé par la garde en production', () => {
    const verifier = createAttestationVerifier({
      ...base,
      production: false,
      androidAttestationRoots: null,
    });
    expect(verifier).toBeInstanceOf(FakeAttestation);
    expect(() =>
      assertNoFakeInProduction(true, { 'le vérificateur d’attestation': verifier }),
    ).toThrow(FakeInProductionError);
  });

  it('en production, la fabrique ne construit jamais le faux', () => {
    expect(() =>
      createAttestationVerifier({ ...base, production: true, androidAttestationRoots: null }),
    ).toThrow(FakeInProductionError);
  });

  it('en production, une racine de test fait refuser le démarrage', () => {
    expect(() =>
      createAttestationVerifier(
        { ...base, production: true, androidAttestationRoots: rootsFile },
        { revocationSource: async () => ({ entries: {} }) },
      ),
    ).toThrow(/racine d’attestation de test interdite en production/);
  });

  it('avec racines : vérificateur réel (pas un faux), Android vérifié, iOS refusé', async () => {
    const verifier = createAttestationVerifier(
      { ...base, production: false, androidAttestationRoots: rootsFile },
      { revocationSource: async () => ({ entries: {} }) },
    );
    expect(verifier).toBeInstanceOf(AttestationRouter);
    expect(verifier.isFake).toBeUndefined();
    await expect(verifier.verify(await input())).resolves.toMatchObject({
      kind: 'ANDROID_KEY_ATTESTATION',
    });
    await refusal(
      verifier.verify({ ...(await input()), os: 'IOS', agreementAttestationChain: null }),
      /IOS non pris en charge/,
    );
  });

  it('fichier de racines sans certificat : démarrage refusé', () => {
    const empty = join(dir, 'empty.pem');
    writeFileSync(empty, 'rien');
    expect(() =>
      createAttestationVerifier({ ...base, production: false, androidAttestationRoots: empty }),
    ).toThrow(/aucun certificat PEM/);
  });
});
