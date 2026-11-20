// Objets App Attest DE TEST (WP11, T053) : racine et intermédiaire générés à l'exécution (aucune
// clé dans le dépôt), feuille portant l'extension de nonce d'Apple, `authData` construit octet par
// octet (rpIdHash, drapeaux, compteur, aaguid, credentialId), objet encodé en CBOR. Chaque champ
// est paramétrable pour fabriquer un cas refusé ; le nonce est recalculé sur l'`authData` final,
// sauf s'il est imposé. La racine de test porte TEST_ATTESTATION_ROOT_MARKER dans son sujet
// (refusée en production) et n'est acceptée que si un test la passe explicitement au vérificateur.
import 'reflect-metadata';
import { createHash, webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { encode } from 'cbor2';
import { TEST_ATTESTATION_ROOT_MARKER } from '../../../src/attestation/attestation.module';
import {
  AAGUID_PRODUCTION,
  APP_ATTEST_FORMAT,
  APPLE_NONCE_EXTENSION_OID,
  FLAG_ATTESTED_CREDENTIAL_DATA,
} from '../../../src/attestation/ios-app-attest';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

const crypto = webcrypto;
x509.cryptoProvider.set(crypto as never);

const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

/**
 * Équipe et bundle de l'app de test : valeurs hors production de config.ts
 * (`TEST_DEVICE_SETTINGS`).
 */
export const TEST_IOS_TEAM_ID = 'TESTTEAM01';
export const TEST_IOS_BUNDLE_ID = 'org.cashless.terminal';
const TEST_IOS_ROOT_NAME = 'CN=Cashless TEST Apple App Attestation root';
export const TEST_IOS_ROOT_SUBJECT = `${TEST_IOS_ROOT_NAME}, O=${TEST_ATTESTATION_ROOT_MARKER}`;
export const TEST_IOS_INTERMEDIATE_SUBJECT = 'CN=Cashless TEST Apple App Attestation CA 1';

export interface IosTestPki {
  rootCert: x509.X509Certificate;
  rootKeys: CryptoKeyPair;
  intermediateCert: x509.X509Certificate;
  intermediateKeys: CryptoKeyPair;
  /**
   * DER de la racine, à passer explicitement au vérificateur (absente de `x5c`, comme chez Apple).
   */
  rootDer: Buffer;
  rootPem: string;
}

export function keyPair(namedCurve: 'P-256' | 'P-384' = 'P-256'): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, ['sign', 'verify']);
}

export async function spki(key: CryptoKey): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.exportKey('spki', key));
}

/** Point non compressé de la clé (ce que hache `credentialId`). */
export async function rawPoint(key: CryptoKey): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.exportKey('raw', key));
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

export function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/**
 * Racine et intermédiaire de test. Une autre PKI créée avec les MÊMES sujets a un intermédiaire au
 * même nom d'émetteur, signé par une autre clé : cas « racine inconnue » sans écart de nom.
 */
export async function createIosTestPki(
  options: { rootNotAfter?: Date; intermediateCa?: boolean } = {},
): Promise<IosTestPki> {
  const rootKeys = await keyPair();
  const rootCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: TEST_IOS_ROOT_SUBJECT,
    notBefore: new Date(Date.now() - 2 * DAY),
    notAfter: options.rootNotAfter ?? new Date(Date.now() + 30 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    keys: rootKeys,
    extensions: caExtensions(),
  });
  const intermediateKeys = await keyPair();
  const intermediateCert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: TEST_IOS_INTERMEDIATE_SUBJECT,
    issuer: rootCert.subject,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 30 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    extensions: caExtensions(options.intermediateCa ?? true),
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

/** Champs de `authData` modifiables un à un. */
export interface AuthDataFields {
  rpId: string;
  flags: number;
  counter: number;
  aaguid: Buffer;
  /** Défaut : SHA-256 du point non compressé de la clé attestée. */
  credentialId: Buffer | null;
  /** COSE de la clé (non vérifié par le serveur : Apple ne le demande pas). */
  credentialPublicKey: Buffer;
}

export function authData(fields: AuthDataFields, credentialId: Buffer): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(fields.counter);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  return Buffer.concat([
    sha256(Buffer.from(fields.rpId, 'utf8')),
    Buffer.from([fields.flags]),
    counter,
    fields.aaguid,
    length,
    credentialId,
    fields.credentialPublicKey,
  ]);
}

/** Valeur DER de l'extension de nonce : SEQUENCE { [1] EXPLICIT OCTET STRING nonce }. */
export function nonceExtensionValue(nonce: Buffer): Buffer {
  return Buffer.concat([Buffer.from('3024a1220420', 'hex'), nonce]);
}

export interface AppAttestOptions {
  /** Clé App Attest attestée par la feuille. */
  publicKey: CryptoKey;
  /** `clientDataHash` lié par le nonce (en général `iosClientDataHash(...)`). */
  clientDataHash: Buffer;
  pki: IosTestPki;
  fields?: Partial<AuthDataFields>;
  /** `authData` brut à la place du construit (cas tronqué). */
  rawAuthData?: Buffer;
  /** Nonce imposé ; défaut : SHA-256(authData ‖ clientDataHash). */
  nonce?: Buffer;
  /** Valeur DER brute de l'extension de nonce ; `null` : pas d'extension dans la feuille. */
  nonceExtension?: Buffer | null;
  /** Extension de nonce posée deux fois dans la feuille. */
  duplicateNonceExtension?: boolean;
  /** Extension de nonce posée aussi dans l'intermédiaire. */
  nonceInIntermediate?: boolean;
  /** Clé qui signe la feuille (défaut : celle de l'intermédiaire). */
  leafSigningKey?: CryptoKey;
  /** Émetteur de la feuille (défaut : sujet de l'intermédiaire). */
  leafIssuer?: string;
  leafNotBefore?: Date;
  leafNotAfter?: Date;
  /**
   * `x5c` imposé (DER, en Uint8Array pour `cbor2`) : la feuille construite est passée à cette
   * fonction.
   */
  x5c?: (leaf: Uint8Array, intermediate: Uint8Array) => unknown[];
  /** Objet CBOR imposé : la table construite est passée à cette fonction. */
  object?: (built: Map<string, unknown>) => unknown;
}

export function defaultAuthDataFields(): AuthDataFields {
  return {
    rpId: `${TEST_IOS_TEAM_ID}.${TEST_IOS_BUNDLE_ID}`,
    flags: FLAG_ATTESTED_CREDENTIAL_DATA,
    counter: 0,
    aaguid: AAGUID_PRODUCTION,
    credentialId: null,
    credentialPublicKey: Buffer.from('a50102032620012158200000', 'hex'),
  };
}

/** Objet App Attest de test, encodé en CBOR (`key_attestation_chain[0]`). */
export async function appAttestObject(options: AppAttestOptions): Promise<Buffer> {
  const fields = { ...defaultAuthDataFields(), ...options.fields };
  const credentialId = fields.credentialId ?? sha256(await rawPoint(options.publicKey));
  const data = options.rawAuthData ?? authData(fields, credentialId);
  const nonce = options.nonce ?? sha256(data, options.clientDataHash);
  const extensionValue =
    options.nonceExtension === undefined ? nonceExtensionValue(nonce) : options.nonceExtension;
  const nonceExtension = (value: Buffer) =>
    new x509.Extension(APPLE_NONCE_EXTENSION_OID, false, value);

  const { pki } = options;
  let intermediate = pki.intermediateCert;
  if (options.nonceInIntermediate)
    intermediate = await x509.X509CertificateGenerator.create({
      serialNumber: serial(),
      subject: pki.intermediateCert.subject,
      issuer: pki.rootCert.subject,
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + 30 * DAY),
      signingAlgorithm: ECDSA_SHA256,
      publicKey: pki.intermediateKeys.publicKey,
      signingKey: pki.rootKeys.privateKey,
      extensions: [...caExtensions(), nonceExtension(nonceExtensionValue(nonce))],
    });
  const extensions =
    extensionValue === null
      ? []
      : options.duplicateNonceExtension
        ? [nonceExtension(extensionValue), nonceExtension(extensionValue)]
        : [nonceExtension(extensionValue)];
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: 'CN=0123456789abcdef, OU=AAA Certification, O=Apple Inc., ST=California',
    issuer: options.leafIssuer ?? intermediate.subject,
    notBefore: options.leafNotBefore ?? new Date(Date.now() - DAY),
    notAfter: options.leafNotAfter ?? new Date(Date.now() + 3 * DAY),
    signingAlgorithm: ECDSA_SHA256,
    publicKey: options.publicKey,
    signingKey: options.leafSigningKey ?? pki.intermediateKeys.privateKey,
    extensions,
  });
  // `cbor2` encode un Buffer par son `toJSON` : les chaînes d'octets passent en Uint8Array.
  const leafDer = new Uint8Array(leaf.rawData);
  const intermediateDer = new Uint8Array(intermediate.rawData);
  const built = new Map<string, unknown>([
    ['fmt', APP_ATTEST_FORMAT],
    [
      'attStmt',
      new Map<string, unknown>([
        ['x5c', options.x5c ? options.x5c(leafDer, intermediateDer) : [leafDer, intermediateDer]],
        ['receipt', new Uint8Array(Buffer.from('reçu de test'))],
      ]),
    ],
    ['authData', new Uint8Array(data)],
  ]);
  return Buffer.from(encode(options.object ? options.object(built) : built));
}

/** Entier ASN.1 DER positif depuis un entier grand-boutiste de longueur fixe (r ou s). */
function derInteger(raw: Uint8Array): Buffer {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  let body = Buffer.from(raw.subarray(start));
  if (body[0]! & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return Buffer.concat([Buffer.from([0x02, body.length]), body]);
}

/** Signature ECDSA P-256 « r ‖ s » (WebCrypto) → SEQUENCE DER { r, s }, écrite à la main. */
export function rawSignatureToDer(raw: Uint8Array): Buffer {
  const body = Buffer.concat([derInteger(raw.subarray(0, 32)), derInteger(raw.subarray(32))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

export interface AppAssertionOptions {
  /** Clé privée App Attest de l'appareil. */
  privateKey: CryptoKey;
  /** Condensé de la requête (déjà calculé). */
  clientDataHash: Buffer;
  counter: number;
  /** `<équipe>.<bundle>` ; défaut : l'app de test. */
  rpId?: string;
  /** Drapeaux de `authenticatorData` (défaut 0 : ni AT ni ED). */
  flags?: number;
  /** Signature imposée (DER ou autre). */
  signatureOverride?: Buffer;
  /** Clés CBOR supplémentaires (cas « clé en trop »). */
  extraKeys?: Array<[string, unknown]>;
  /** Clés CBOR retirées (cas « clé manquante »). */
  omitKeys?: string[];
  /** `authenticatorData` brut à la place du construit (longueur inattendue). */
  rawAuthenticatorData?: Buffer;
}

/**
 * Assertion App Attest DE TEST, écrite d'après la procédure d'Apple (« Validating apps that connect
 * to your server »), PAS d'après le vérificateur : `authenticatorData = rpIdHash(32) ‖ flags(1) ‖
 * compteur(4, grand-boutiste)` ; `nonce = SHA-256(authenticatorData ‖ clientDataHash)` ; signature
 * ECDSA-SHA256 de `nonce` COMME MESSAGE (WebCrypto hache lui-même), convertie en DER ; objet CBOR
 * `{ signature, authenticatorData }`. Ne remplace pas un vecteur réel d'Apple (limite R1, OP-N64).
 */
export async function appAssertion(options: AppAssertionOptions): Promise<Buffer> {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(options.counter);
  const data =
    options.rawAuthenticatorData ??
    Buffer.concat([
      sha256(Buffer.from(options.rpId ?? `${TEST_IOS_TEAM_ID}.${TEST_IOS_BUNDLE_ID}`, 'utf8')),
      Buffer.from([options.flags ?? 0]),
      counter,
    ]);
  const nonce = sha256(data, options.clientDataHash);
  const signature =
    options.signatureOverride ??
    rawSignatureToDer(
      new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, options.privateKey, nonce)),
    );
  const entries: Array<[string, unknown]> = [
    ['signature', new Uint8Array(signature)],
    ['authenticatorData', new Uint8Array(data)],
    ...(options.extraKeys ?? []),
  ];
  const omitted = new Set(options.omitKeys ?? []);
  return Buffer.from(encode(new Map(entries.filter(([key]) => !omitted.has(key)))));
}
