// Chaînes Android Key Attestation DE TEST (WP10, T050) : racine et intermédiaire générés à l'exécution (aucune clé
// dans le dépôt), feuille portant une extension KeyDescription construite avec `@peculiar/asn1-android`, paramétrable
// champ par champ pour fabriquer chaque cas refusé. La racine de test porte TEST_ATTESTATION_ROOT_MARKER dans son
// sujet (refusée en production) et n'est acceptée que si un test la passe explicitement au vérificateur.
import 'reflect-metadata';
import { createHash, webcrypto } from 'node:crypto';
import {
  AttestationApplicationId,
  AttestationPackageInfo,
  AuthorizationList,
  id_ce_keyDescription,
  IntegerSet,
  KeyDescription,
  RootOfTrust,
  SecurityLevel,
  VerifiedBootState,
} from '@peculiar/asn1-android';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import * as x509 from '@peculiar/x509';
import {
  KM_ALGORITHM_EC,
  KM_EC_CURVE_P_256,
  KM_ORIGIN_GENERATED,
  KM_PURPOSE_AGREE_KEY,
  KM_PURPOSE_SIGN,
} from '../../../src/attestation/android-key-attestation';
import { TEST_ATTESTATION_ROOT_MARKER } from '../../../src/attestation/attestation.module';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

const crypto = webcrypto;
x509.cryptoProvider.set(crypto as never);

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

/** Paquet et empreinte de l'app de test : valeurs hors production de config.ts (`TEST_DEVICE_SETTINGS`). */
export const TEST_ANDROID_PACKAGE = 'org.cashless.terminal';
export const TEST_ANDROID_SIGNING_DIGEST = createHash('sha256')
  .update('cashless-terminal-test-signing')
  .digest();

export interface AndroidTestPki {
  rootCert: x509.X509Certificate;
  rootKeys: CryptoKeyPair;
  intermediateCert: x509.X509Certificate;
  intermediateKeys: CryptoKeyPair;
  /** DER de la racine, à passer explicitement au vérificateur. */
  rootDer: Buffer;
  rootPem: string;
}

export function p256KeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(EC_P256, true, ['sign', 'verify']);
}

export async function spki(key: CryptoKey): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.exportKey('spki', key));
}

function serial(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = bytes[0]! & 0x7f;
  return Buffer.from(bytes).toString('hex');
}

function caExtensions(ca = true): x509.Extension[] {
  return [
    new x509.BasicConstraintsExtension(ca, undefined, true),
    new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
  ];
}

export const TEST_INTERMEDIATE_SUBJECT = 'CN=Cashless TEST Android attestation intermediate';
/** Sujet des feuilles, comme celui de Keystore. */
export const TEST_LEAF_SUBJECT = 'CN=Android Keystore Key';

/**
 * Racine et intermédiaire de test, générés à l'exécution. `intermediateSubject` : un autre sujet
 * d'intermédiaire, pour qu'une feuille d'une autre PKI ait un autre émetteur (chaînage par nom).
 */
export async function createAndroidTestPki(
  intermediateSubject = TEST_INTERMEDIATE_SUBJECT,
): Promise<AndroidTestPki> {
  const rootKeys = await p256KeyPair();
  const rootCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=Cashless TEST Android attestation root, O=${TEST_ATTESTATION_ROOT_MARKER}`,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 30 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    keys: rootKeys,
    extensions: caExtensions(),
  });
  const intermediateKeys = await p256KeyPair();
  const intermediateCert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: intermediateSubject,
    issuer: rootCert.subject,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 30 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    extensions: caExtensions(),
  });
  return {
    rootCert,
    rootKeys,
    intermediateCert,
    intermediateKeys,
    rootDer: Buffer.from(rootCert.rawData),
    rootPem: rootCert.toString('pem'),
  };
}

/** Champs de KeyDescription modifiables un à un ; `null` retire le champ. */
export interface KeyDescriptionFields {
  attestationVersion: number;
  attestationSecurityLevel: SecurityLevel;
  keymasterSecurityLevel: SecurityLevel;
  challenge: Buffer;
  origin: number | null;
  purpose: number[] | null;
  algorithm: number | null;
  ecCurve: number | null;
  deviceLocked: boolean;
  verifiedBootState: VerifiedBootState;
  /** `null` : pas de rootOfTrust dans la liste matérielle. */
  rootOfTrust: boolean | null;
  /** « Appareil » de test dans rootOfTrust ; `verifiedBootHash = null` retire le champ. */
  verifiedBootKey: Buffer;
  verifiedBootHash: Buffer | null;
  osPatchLevel: number | null;
  vendorPatchLevel: number | null;
  bootPatchLevel: number | null;
  packages: string[];
  signatureDigests: Buffer[];
  /**
   * Liste(s) où figure `attestationApplicationId` : `software` comme sur un vrai appareil (Keystore), `hardware`,
   * `both`, ou `none` (OP-N67 / ADR-110).
   */
  applicationIdIn: 'software' | 'hardware' | 'both' | 'none';
  /** Paquets de la copie MATÉRIELLE quand `applicationIdIn = both` (incohérence) ; défaut : `packages`. */
  hardwarePackages: string[] | null;
  /** Place `rootOfTrust` dans `softwareEnforced` au lieu de la liste matérielle (test de borne). */
  rootOfTrustInSoftwareList: boolean;
  /** Place toutes les autorisations dans `softwareEnforced` au lieu de la liste matérielle. */
  inSoftwareList: boolean;
}

export type Purpose = 'SIGN' | 'AGREE_KEY';

export function defaultKeyDescription(purpose: Purpose, challenge: Buffer): KeyDescriptionFields {
  return {
    attestationVersion: 200,
    attestationSecurityLevel: SecurityLevel.trustedEnvironment,
    keymasterSecurityLevel: SecurityLevel.trustedEnvironment,
    challenge,
    origin: KM_ORIGIN_GENERATED,
    purpose: [purpose === 'SIGN' ? KM_PURPOSE_SIGN : KM_PURPOSE_AGREE_KEY],
    algorithm: KM_ALGORITHM_EC,
    ecCurve: KM_EC_CURVE_P_256,
    deviceLocked: true,
    verifiedBootState: VerifiedBootState.verified,
    rootOfTrust: true,
    verifiedBootKey: Buffer.alloc(32, 7),
    verifiedBootHash: Buffer.alloc(32, 9),
    osPatchLevel: 202409,
    vendorPatchLevel: 20240905,
    bootPatchLevel: 20240905,
    packages: [TEST_ANDROID_PACKAGE],
    signatureDigests: [TEST_ANDROID_SIGNING_DIGEST],
    applicationIdIn: 'software',
    hardwarePackages: null,
    rootOfTrustInSoftwareList: false,
    inSoftwareList: false,
  };
}

function applicationIdDer(packages: string[], signatureDigests: Buffer[]): OctetString {
  const application = new AttestationApplicationId({
    packageInfos: packages.map(
      (name) =>
        new AttestationPackageInfo({
          packageName: new OctetString(Buffer.from(name, 'utf8')),
          version: 1,
        }),
    ),
    signatureDigests: signatureDigests.map((digest) => new OctetString(digest)),
  });
  return new OctetString(AsnConvert.serialize(application));
}

/** DER de l'extension KeyDescription. */
export function keyDescriptionDer(fields: KeyDescriptionFields): Buffer {
  const rootOfTrust = fields.rootOfTrust
    ? new RootOfTrust({
        verifiedBootKey: new OctetString(fields.verifiedBootKey),
        deviceLocked: fields.deviceLocked,
        verifiedBootState: fields.verifiedBootState,
        ...(fields.verifiedBootHash
          ? { verifiedBootHash: new OctetString(fields.verifiedBootHash) }
          : {}),
      })
    : null;
  const softwareApplicationId = ['software', 'both'].includes(fields.applicationIdIn)
    ? applicationIdDer(fields.packages, fields.signatureDigests)
    : null;
  const hardwareApplicationId = ['hardware', 'both'].includes(fields.applicationIdIn)
    ? applicationIdDer(fields.hardwarePackages ?? fields.packages, fields.signatureDigests)
    : null;
  const hardware = new AuthorizationList({
    ...(fields.purpose ? { purpose: new IntegerSet(fields.purpose) } : {}),
    ...(fields.algorithm !== null ? { algorithm: fields.algorithm } : {}),
    ...(fields.ecCurve !== null ? { ecCurve: fields.ecCurve } : {}),
    ...(fields.origin !== null ? { origin: fields.origin } : {}),
    ...(rootOfTrust && !fields.rootOfTrustInSoftwareList ? { rootOfTrust } : {}),
    ...(fields.osPatchLevel !== null ? { osPatchLevel: fields.osPatchLevel } : {}),
    ...(hardwareApplicationId ? { attestationApplicationId: hardwareApplicationId } : {}),
    ...(fields.vendorPatchLevel !== null ? { vendorPatchLevel: fields.vendorPatchLevel } : {}),
    ...(fields.bootPatchLevel !== null ? { bootPatchLevel: fields.bootPatchLevel } : {}),
  });
  const software = new AuthorizationList({
    ...(rootOfTrust && fields.rootOfTrustInSoftwareList ? { rootOfTrust } : {}),
    ...(softwareApplicationId ? { attestationApplicationId: softwareApplicationId } : {}),
  });
  const description = new KeyDescription({
    attestationVersion: fields.attestationVersion,
    attestationSecurityLevel: fields.attestationSecurityLevel,
    keymasterVersion: fields.attestationVersion,
    keymasterSecurityLevel: fields.keymasterSecurityLevel,
    attestationChallenge: new OctetString(fields.challenge),
    uniqueId: new OctetString(Buffer.alloc(0)),
    // `inSoftwareList` : tout dans softwareEnforced (les deux listes fusionnées), rien dans la liste matérielle.
    softwareEnforced: fields.inSoftwareList
      ? new AuthorizationList({ ...hardware, ...stripUndefined(software) })
      : software,
    teeEnforced: fields.inSoftwareList ? new AuthorizationList() : hardware,
  });
  return Buffer.from(AsnConvert.serialize(description));
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export interface ChainOptions {
  /** Clé publique attestée par la feuille. */
  publicKey: CryptoKey;
  purpose: Purpose;
  challenge: Buffer;
  /** Champs de KeyDescription à remplacer. */
  fields?: Partial<KeyDescriptionFields>;
  /** Pose aussi l'extension KeyDescription dans l'intermédiaire (cas refusé). */
  keyDescriptionInIntermediate?: boolean;
  /** Intermédiaire refait avec ces réglages (cas refusés) : `ca: false`, dates. */
  intermediate?: { ca?: boolean; notBefore?: Date; notAfter?: Date };
  /** Début de validité de la feuille (cas pas encore valide). */
  leafNotBefore?: Date;
  /** Fin de validité de la feuille (cas expiré). */
  leafNotAfter?: Date;
  /** Numéro de série de la feuille (hexadécimal), pour la liste de révocation. */
  leafSerial?: string;
}

/** Chaîne feuille → intermédiaire → racine (DER), feuille en premier. */
export async function androidAttestationChain(
  pki: AndroidTestPki,
  options: ChainOptions,
): Promise<Buffer[]> {
  const keyDescription = keyDescriptionExtension(
    options.purpose,
    options.challenge,
    options.fields,
  );
  let intermediate = pki.intermediateCert;
  if (options.keyDescriptionInIntermediate || options.intermediate)
    intermediate = await x509.X509CertificateGenerator.create({
      serialNumber: serial(),
      subject: pki.intermediateCert.subject,
      issuer: pki.rootCert.subject,
      notBefore: options.intermediate?.notBefore ?? new Date(Date.now() - DAY),
      notAfter: options.intermediate?.notAfter ?? new Date(Date.now() + 30 * DAY),
      signingAlgorithm: ECDSA_SHA256,
      publicKey: pki.intermediateKeys.publicKey,
      signingKey: pki.rootKeys.privateKey,
      extensions: [
        ...caExtensions(options.intermediate?.ca ?? true),
        ...(options.keyDescriptionInIntermediate ? [keyDescription] : []),
      ],
    });
  const leaf = await attestationLeaf({
    issuer: intermediate.subject,
    signingKey: pki.intermediateKeys.privateKey,
    publicKey: options.publicKey,
    keyDescription,
    serialNumber: options.leafSerial,
    notBefore: options.leafNotBefore,
    notAfter: options.leafNotAfter,
  });
  return [leaf, intermediate, pki.rootCert].map((cert) => Buffer.from(cert.rawData));
}

/** Extension KeyDescription de test (pour forger une feuille hors de `androidAttestationChain`). */
export function keyDescriptionExtension(
  purpose: Purpose,
  challenge: Buffer,
  fields: Partial<KeyDescriptionFields> = {},
): x509.Extension {
  const all = { ...defaultKeyDescription(purpose, challenge), ...fields };
  return new x509.Extension(id_ce_keyDescription, false, keyDescriptionDer(all));
}

/**
 * Feuille d'attestation, sans basicConstraints comme sur un vrai appareil. `signingKey` peut être
 * la clé privée d'une autre feuille : attaque « une clé attestée signe une feuille forgée ».
 */
export function attestationLeaf(options: {
  issuer: string;
  signingKey: CryptoKey;
  publicKey: CryptoKey;
  keyDescription: x509.Extension;
  serialNumber?: string;
  notBefore?: Date;
  notAfter?: Date;
}): Promise<x509.X509Certificate> {
  return x509.X509CertificateGenerator.create({
    serialNumber: options.serialNumber ?? serial(),
    subject: TEST_LEAF_SUBJECT,
    issuer: options.issuer,
    notBefore: options.notBefore ?? new Date(Date.now() - DAY),
    notAfter: options.notAfter ?? new Date(Date.now() + 30 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    publicKey: options.publicKey,
    signingKey: options.signingKey,
    extensions: [options.keyDescription],
  });
}
