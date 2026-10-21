// Vérification iOS App Attest à l'enrôlement (research R-06, R-08 ; décision du porteur
// DM-01M59SD0YNWKK8R4EKT2T7THJK), selon la procédure d'Apple « Validating apps that connect to your
// server » : objet CBOR `apple-appattest`, chaîne `x5c` jusqu'à la racine Apple App Attestation
// configurée, nonce, rpIdHash, compteur, aaguid, credentialId.
//
// LIMITE ACCEPTÉE — OP-N64 / ADR-106 (bloque la production : non ; réexaminée par la mission 12,
// app terminal) :
// - PROUVÉ : une instance réelle de l'app attendue (équipe et bundle), sur un appareil Apple
//   authentique, a produit une clé App Attest dans la Secure Enclave et a lié cette attestation au
//   `clientDataHash` de R-08, qui couvre le code d'enrôlement, le `serial`, la clé publique de
//   signature et la clé publique d'accord. Un tiers ne peut donc pas substituer ses clés à celles
//   de l'instance attestée (seule protection contre la substitution, R-06).
// - NON PROUVÉ : que la clé de signature ECDSA P-256 du terminal (requêtes, CSR, mTLS) et sa clé
//   d'accord sont dans la Secure Enclave et non exportables. App Attest n'atteste que SA propre
//   clé, distincte des deux autres.
// - Condition de levée : requêtes iOS signées par assertion App Attest (ou preuve équivalente).
//   Borne tenue ailleurs : un terminal iOS n'a jamais `nfc_enabled` et `POST /media/auth-keys` le
//   refuse.
//
// Toute la cryptographie passe par `node:crypto` (X509Certificate.verify, createHash) ; `cbor2` et
// `@peculiar/asn1-*` ne servent qu'à LIRE la structure. Le reçu (`attStmt.receipt`, mesure de
// fraude d'Apple) n'est pas exploité.
//
// À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, CLAUDE.md « Revue »).
import { createHash, timingSafeEqual, X509Certificate, type KeyObject } from 'node:crypto';
import { AsnConvert } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import { decode } from 'cbor2';
import type { IosAppAttestEnvironment } from '../config/config';
import {
  AttestationError,
  type AttestationInput,
  type AttestationResult,
  type AttestationVerifier,
} from './attestation.port';
import { iosClientDataHash } from './enrollment-challenge';

/** Extension de la feuille qui porte le nonce (procédure d'Apple). */
export const APPLE_NONCE_EXTENSION_OID = '1.2.840.113635.100.8.2';
export const APP_ATTEST_FORMAT = 'apple-appattest';
/** `aaguid` d'une app signée pour la distribution : « appattest » suivi de sept octets nuls. */
export const AAGUID_PRODUCTION = Buffer.concat([
  Buffer.from('appattest', 'ascii'),
  Buffer.alloc(7),
]);
/** `aaguid` d'une app signée pour le développement : refusé en production. */
export const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop', 'ascii');
/** Drapeau « attested credential data » de `authData` (WebAuthn). */
export const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;
/**
 * Encodage DER attendu de l'extension de nonce, sans le nonce : SEQUENCE { [1] EXPLICIT OCTET
 * STRING (32) }. Le DER étant canonique, la valeur entière est comparée octet à octet à cet en-tête
 * suivi du nonce calculé.
 */
const NONCE_EXTENSION_PREFIX = Buffer.from('3024a1220420', 'hex');
/** Bornes (renforcement : un objet ou une chaîne démesurés sont refusés avant tout calcul). */
const MAX_ATTESTATION_OBJECT_BYTES = 32_768;
const MAX_CHAIN_LENGTH = 5;

// Décalages de `authData` (WebAuthn §6.1).
const RP_ID_HASH_END = 32;
const FLAGS_OFFSET = 32;
const COUNTER_OFFSET = 33;
const AAGUID_OFFSET = 37;
const CREDENTIAL_ID_LENGTH_OFFSET = 53;
const CREDENTIAL_ID_OFFSET = 55;

export interface IosAppAttestSettings {
  /**
   * Racine(s) Apple App Attestation (DER) : `IOS_APP_ATTEST_ROOT`. Absente(s) de `x5c`, ajoutée(s)
   * ici.
   */
  roots: readonly Buffer[];
  /** Identifiant d'équipe Apple (`IOS_TEAM_ID`). */
  teamId: string;
  /** Identifiant de l'application (`IOS_BUNDLE_ID`). */
  bundleId: string;
  /**
   * `IOS_APP_ATTEST_ENVIRONMENT` : `development` admet aussi `appattestdevelop`, hors production
   * seulement.
   */
  environment: IosAppAttestEnvironment;
  /** Configuration de production : `development` y fait refuser la construction (T054). */
  production: boolean;
  /** Horloge (tests). */
  now?: () => Date;
}

function fail(reason: string): never {
  throw new AttestationError(`iOS : ${reason}`);
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/**
 * Chaîne d'octets CBOR ; test sans `instanceof` (un Buffer d'un autre contexte d'exécution reste
 * reconnu).
 */
function isBytes(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function byteString(value: unknown, name: string): Buffer {
  if (!isBytes(value)) return fail(`${name} : chaîne d’octets attendue`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

interface ParsedCert {
  x509: X509Certificate;
  asn: Certificate;
}

function parseCert(der: Buffer, index: number): ParsedCert {
  try {
    return { x509: new X509Certificate(der), asn: AsnConvert.parse(der, Certificate) };
  } catch {
    return fail(`certificat ${index} illisible`);
  }
}

function nonceExtensions(cert: ParsedCert) {
  return (cert.asn.tbsCertificate.extensions ?? []).filter(
    (extension) => extension.extnID === APPLE_NONCE_EXTENSION_OID,
  );
}

/** Point non compressé (65 octets) d'une clé P-256 : ce que hache `credentialId` selon Apple. */
function uncompressedPoint(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return fail('clé de la feuille');
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
}

interface AttestationObject {
  x5c: Buffer[];
  authData: Buffer;
}

export class IosAppAttestVerifier implements AttestationVerifier {
  private readonly roots: readonly X509Certificate[];
  private readonly rpIdHash: Buffer;
  private readonly aaguids: readonly Buffer[];
  private readonly now: () => Date;

  constructor(settings: IosAppAttestSettings) {
    if (settings.roots.length === 0) throw new Error('attestation iOS : aucune racine configurée');
    if (settings.production && settings.environment !== 'production')
      throw new Error('attestation iOS : environnement « production » exigé en production');
    this.roots = settings.roots.map((root) => new X509Certificate(root));
    this.rpIdHash = sha256(Buffer.from(`${settings.teamId}.${settings.bundleId}`, 'utf8'));
    this.aaguids =
      settings.environment === 'production'
        ? [AAGUID_PRODUCTION]
        : [AAGUID_PRODUCTION, AAGUID_DEVELOPMENT];
    this.now = settings.now ?? (() => new Date());
  }

  async verify(input: AttestationInput): Promise<AttestationResult> {
    if (input.os !== 'IOS') fail(`système ${input.os} adressé au vérificateur iOS`);
    if (input.agreementAttestationChain && input.agreementAttestationChain.length > 0)
      fail('chaîne d’attestation de la clé d’accord inattendue');
    if (input.keyAttestationChain.length !== 1) fail('un seul objet App Attest attendu');
    if (sameBytes(input.signingPublicKey, input.agreementPublicKey))
      fail('clés de signature et d’accord identiques');

    const { x5c, authData } = this.decodeObject(input.keyAttestationChain[0]!);
    const leaf = this.checkChain(x5c);

    // R-08 : le défi couvre le code, le serial et les DEUX clés publiques annoncées.
    const clientDataHash = iosClientDataHash(
      input.enrollmentCode,
      input.serial,
      input.signingPublicKey,
      input.agreementPublicKey,
    );
    const nonce = sha256(authData, clientDataHash);
    const extension = nonceExtensions(leaf)[0]!;
    const raw = extension.extnValue;
    const value = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    if (!sameBytes(value, Buffer.concat([NONCE_EXTENSION_PREFIX, nonce])))
      fail('nonce différent du nonce attendu');

    this.checkAuthData(authData, leaf.x509.publicKey);
    return { kind: 'IOS_APP_ATTEST', securityLevel: null };
  }

  /** CBOR : `fmt = apple-appattest`, `attStmt.x5c` (chaînes d'octets), `authData`. */
  private decodeObject(raw: Buffer): AttestationObject {
    if (raw.length > MAX_ATTESTATION_OBJECT_BYTES) fail('objet App Attest trop long');
    let object: unknown;
    try {
      object = decode(raw, {
        preferMap: true,
        rejectDuplicateKeys: true,
        rejectStreaming: true,
        ignoreGlobalTags: true,
      });
    } catch {
      return fail('objet App Attest illisible (CBOR)');
    }
    if (!(object instanceof Map)) return fail('objet App Attest : table CBOR attendue');
    if (object.get('fmt') !== APP_ATTEST_FORMAT) fail(`format ≠ ${APP_ATTEST_FORMAT}`);
    const statement: unknown = object.get('attStmt');
    if (!(statement instanceof Map)) return fail('attStmt absent');
    const x5c: unknown = statement.get('x5c');
    if (!Array.isArray(x5c)) return fail('attStmt.x5c absent');
    return {
      x5c: x5c.map((der: unknown, index) => byteString(der, `x5c[${index}]`)),
      authData: byteString(object.get('authData'), 'authData'),
    };
  }

  /**
   * Chaînage explicite (comme WP10) : `x5c` = feuille puis intermédiaire(s), la racine configurée
   * ajoutée en bout. Émetteur = sujet du suivant, suivant autorité, signature, dates (racine
   * comprise) ; extension de nonce unique, dans la feuille seulement ; clé de la feuille P-256.
   * Rend la feuille.
   */
  private checkChain(x5c: readonly Buffer[]): ParsedCert {
    if (x5c.length < 2) fail('chaîne trop courte');
    if (x5c.length > MAX_CHAIN_LENGTH) fail('chaîne trop longue');
    const certs = x5c.map((der, index) => parseCert(der, index));
    const last = certs[certs.length - 1]!.x509;
    const root = this.roots.find(
      (candidate) => last.issuer === candidate.subject && last.verify(candidate.publicKey),
    );
    if (!root) return fail('racine inconnue');
    const chain = [...certs.map((cert) => cert.x509), root];
    const now = this.now().getTime();

    chain.forEach((cert, index) => {
      const notBefore = new Date(cert.validFrom).getTime();
      const notAfter = new Date(cert.validTo).getTime();
      if (!(notBefore <= now && now <= notAfter))
        fail(`certificat ${index} hors de sa période de validité`);
      const next = chain[index + 1];
      if (next) {
        if (cert.issuer !== next.subject)
          fail(`certificat ${index} : émetteur différent du sujet du suivant`);
        if (!next.ca) fail(`certificat ${index + 1} : pas une autorité (basicConstraints)`);
        if (!cert.verify(next.publicKey)) fail(`certificat ${index} : signature invalide`);
      }
    });
    certs.forEach((cert, index) => {
      const extensions = nonceExtensions(cert);
      if (index === 0 && extensions.length !== 1) fail('feuille sans extension de nonce unique');
      if (index > 0 && extensions.length > 0)
        fail(`extension de nonce hors de la feuille (certificat ${index})`);
    });

    const leaf = certs[0]!;
    const key = leaf.x509.publicKey;
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      fail('clé de la feuille autre que P-256');
    return leaf;
  }

  /**
   * rpIdHash, drapeau AT, compteur nul, aaguid admis, credentialId = SHA-256(clé de la feuille).
   */
  private checkAuthData(authData: Buffer, leafKey: KeyObject): void {
    if (authData.length < CREDENTIAL_ID_OFFSET) fail('authData tronqué');
    if (!sameBytes(authData.subarray(0, RP_ID_HASH_END), this.rpIdHash))
      fail('rpIdHash d’une autre application');
    if ((authData[FLAGS_OFFSET]! & FLAG_ATTESTED_CREDENTIAL_DATA) === 0)
      fail('authData sans données de clé attestée');
    if (authData.readUInt32BE(COUNTER_OFFSET) !== 0) fail('compteur ≠ 0');
    const aaguid = authData.subarray(AAGUID_OFFSET, CREDENTIAL_ID_LENGTH_OFFSET);
    if (!this.aaguids.some((allowed) => sameBytes(aaguid, allowed)))
      fail(
        sameBytes(aaguid, AAGUID_DEVELOPMENT)
          ? 'aaguid de développement refusé (environnement production)'
          : 'aaguid inconnu',
      );
    const length = authData.readUInt16BE(CREDENTIAL_ID_LENGTH_OFFSET);
    if (authData.length < CREDENTIAL_ID_OFFSET + length) fail('authData tronqué');
    const credentialId = authData.subarray(CREDENTIAL_ID_OFFSET, CREDENTIAL_ID_OFFSET + length);
    if (!sameBytes(credentialId, sha256(uncompressedPoint(leafKey))))
      fail('credentialId différent de l’empreinte de la clé attestée');
  }
}
