// Vérification Android Key Attestation (research R-05, R-08 ; décisions du porteur DM-01M59RR2KCM2NMTGNR62HXJD76,
// Android 12 minimum DM-01M59WNTT06K1SY81HBK6PT4E8). Deux chaînes : clé de signature (purpose SIGN) et clé d'accord
// (purpose AGREE_KEY), chacune vérifiée jusqu'à une racine configurée, avec son propre défi.
//
// Toute la cryptographie passe par `node:crypto` (X509Certificate.verify, KeyObject) ; `@peculiar/asn1-*` ne sert qu'à
// LIRE la structure (extensions du certificat, KeyDescription). Les contrôles d'autorisation de la clé sont lus dans la
// liste matérielle (`teeEnforced`, nommée `hardwareEnforced` depuis KeyMint 3) et JAMAIS dans `softwareEnforced`,
// à UNE exception près : `attestationApplicationId` (voir `applicationId`, écart OP-N67 / ADR-110).
//
// À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, CLAUDE.md « Revue »).
import { createPublicKey, timingSafeEqual, X509Certificate, type KeyObject } from 'node:crypto';
import {
  AttestationApplicationId,
  AuthorizationList,
  id_ce_keyDescription,
  KeyDescription,
  RootOfTrust,
  SecurityLevel,
  VerifiedBootState,
} from '@peculiar/asn1-android';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import {
  AttestationError,
  type AttestationInput,
  type AttestationResult,
  type AttestationSecurityLevel,
  type AttestationVerifier,
} from './attestation.port';
import { androidAgreeChallenge, androidSignChallenge } from './enrollment-challenge';
import type { RevocationCheck } from './google-revocation-cache';

// Constantes du format Keymaster/KeyMint (tags.h / KeyPurpose, Algorithm, EcCurve, KeyOrigin d'Android).
export const KM_PURPOSE_SIGN = 2;
export const KM_PURPOSE_AGREE_KEY = 6;
export const KM_ALGORITHM_EC = 3;
export const KM_EC_CURVE_P_256 = 1;
export const KM_ORIGIN_GENERATED = 0;
/** KeyMint 1 (Android 12) : première version où la clé d'accord est matérielle (R-05). */
export const MIN_ATTESTATION_VERSION = 100;
/** Borne de la longueur d'une chaîne (renforcement : une chaîne démesurée est refusée avant tout calcul). */
const MAX_CHAIN_LENGTH = 10;

export interface AndroidAttestationSettings {
  /** Racines acceptées (DER) : `ANDROID_ATTESTATION_ROOTS`. Une racine de test n'y est que si on l'y met. */
  roots: readonly Buffer[];
  /** Paquet attendu (`ANDROID_APP_PACKAGE`). */
  packageName: string;
  /** Empreintes SHA-256 autorisées du certificat de signature de l'app, hexadécimal minuscule. */
  signingDigests: readonly string[];
  /** Niveau de correctif minimal `AAAAMM` (`ANDROID_MIN_PATCH_LEVEL`). */
  minPatchLevel: number;
  revocation: RevocationCheck;
  /** Horloge (tests). */
  now?: () => Date;
}

type KeyRole = 'signature' | 'accord';

function fail(role: KeyRole | null, reason: string): never {
  throw new AttestationError(role ? `clé ${role} : ${reason}` : reason);
}

function bytes(octets: OctetString | ArrayBuffer): Buffer {
  return octets instanceof OctetString
    ? Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength)
    : Buffer.from(octets);
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

interface ParsedCert {
  x509: X509Certificate;
  asn: Certificate;
}

function parseCert(der: Buffer, role: KeyRole, index: number): ParsedCert {
  try {
    return { x509: new X509Certificate(der), asn: AsnConvert.parse(der, Certificate) };
  } catch {
    return fail(role, `certificat ${index} illisible`);
  }
}

function keyDescriptionExtensions(cert: ParsedCert) {
  return (cert.asn.tbsCertificate.extensions ?? []).filter(
    (extension) => extension.extnID === id_ce_keyDescription,
  );
}

/**
 * Niveau de correctif normalisé en `AAAAMM` : `osPatchLevel` est `AAAAMM`, vendor et boot `AAAAMMJJ`. Un entier
 * ASN.1 de 4 octets ou plus est rendu en texte décimal par `@peculiar/asn1-schema` : les deux formes sont lues.
 */
function patchMonth(raw: number | string | undefined): number | null {
  const value = typeof raw === 'string' && /^[0-9]{1,9}$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value >= 100_000 && value <= 999_999) return value;
  if (value >= 10_000_000 && value <= 99_999_999) return Math.floor(value / 100);
  return null;
}

function securityLevel(level: SecurityLevel): AttestationSecurityLevel | null {
  if (level === SecurityLevel.trustedEnvironment) return 'TRUSTED_ENVIRONMENT';
  if (level === SecurityLevel.strongBox) return 'STRONGBOX';
  return null;
}

/**
 * `attestationApplicationId` : SEUL champ lu dans `softwareEnforced`. ÉCART DE SÉCURITÉ ACCEPTÉ — OP-N67 / ADR-110
 * (décision du porteur du 19/10/2026) : sur les vrais appareils, le Keystore d'Android pose ce champ dans la liste
 * logicielle ; le lire seulement dans la liste matérielle refuserait tout appareil réel. La valeur reste dans la
 * feuille signée par le TEE, et l'appareil est exigé verrouillé au démarrage vérifié (contrôles matériels). Si le
 * champ figure aussi dans la liste matérielle, cette valeur prime et les deux doivent être identiques (renforcement).
 * Aucun autre champ n'est lu dans `softwareEnforced` : tests de borne « borne OP-N67 » de android.spec.ts.
 */
function applicationId(role: KeyRole, description: KeyDescription): OctetString {
  const hardware = description.teeEnforced.attestationApplicationId;
  const software = description.softwareEnforced.attestationApplicationId;
  if (hardware && software && !sameBytes(bytes(hardware), bytes(software)))
    fail(role, 'attestationApplicationId incohérent entre les listes matérielle et logicielle');
  const value = hardware ?? software;
  if (!value) return fail(role, 'attestationApplicationId absent');
  return value;
}

export class AndroidKeyAttestationVerifier implements AttestationVerifier {
  private readonly roots: readonly Buffer[];
  private readonly digests: ReadonlySet<string>;
  private readonly now: () => Date;

  constructor(private readonly settings: AndroidAttestationSettings) {
    if (settings.roots.length === 0)
      throw new Error('attestation Android : aucune racine configurée');
    if (settings.signingDigests.length === 0)
      throw new Error('attestation Android : aucune empreinte de signature autorisée');
    this.roots = settings.roots.map((root) => Buffer.from(root));
    this.digests = new Set(settings.signingDigests.map((digest) => digest.toLowerCase()));
    this.now = settings.now ?? (() => new Date());
  }

  async verify(input: AttestationInput): Promise<AttestationResult> {
    if (input.os !== 'ANDROID') fail(null, `système ${input.os} adressé au vérificateur Android`);
    if (!input.agreementAttestationChain || input.agreementAttestationChain.length === 0)
      fail('accord', 'chaîne d’attestation absente (Android 12 minimum)');
    if (sameBytes(input.signingPublicKey, input.agreementPublicKey))
      fail(null, 'clés de signature et d’accord identiques');

    const agree = androidAgreeChallenge(input.enrollmentCode, input.serial);
    const sign = androidSignChallenge(input.enrollmentCode, input.serial, input.agreementPublicKey);

    const signing = this.checkKey(
      'signature',
      input.keyAttestationChain,
      input.signingPublicKey,
      sign,
      KM_PURPOSE_SIGN,
    );
    const agreement = this.checkKey(
      'accord',
      input.agreementAttestationChain,
      input.agreementPublicKey,
      agree,
      KM_PURPOSE_AGREE_KEY,
    );

    this.checkSameDevice(signing.rootOfTrust, agreement.rootOfTrust);

    // Chaque certificat des deux chaînes, racine comprise, est absent de la liste de révocation Google.
    await this.settings.revocation.assertNotRevoked([...signing.serials, ...agreement.serials]);

    const levels = [...signing.levels, ...agreement.levels];
    return {
      kind: 'ANDROID_KEY_ATTESTATION',
      securityLevel: levels.every((level) => level === 'STRONGBOX')
        ? 'STRONGBOX'
        : 'TRUSTED_ENVIRONMENT',
    };
  }

  /**
   * T047 + T048 pour une clé ; rend les numéros de série de la chaîne, les niveaux de sécurité
   * attestés et le rootOfTrust de la liste matérielle (déjà contrôlé).
   */
  private checkKey(
    role: KeyRole,
    chain: readonly Buffer[],
    announcedSpki: Buffer,
    expectedChallenge: Buffer,
    purpose: number,
  ): { serials: string[]; levels: AttestationSecurityLevel[]; rootOfTrust: RootOfTrust } {
    const certs = this.checkChain(role, chain);
    const leaf = certs[0]!;
    this.checkLeafKey(role, leaf.x509.publicKey, announcedSpki);
    const description = this.keyDescription(role, leaf);
    const levels = this.checkKeyDescription(role, description, expectedChallenge, purpose);
    return {
      serials: certs.map((cert) => cert.x509.serialNumber),
      levels,
      rootOfTrust: description.teeEnforced.rootOfTrust!,
    };
  }

  /**
   * Renforcement (relecture WP10, constat 5) : les deux clés viennent du même appareil. Même
   * `verifiedBootKey` et même `verifiedBootHash` ; un hash dans une seule chaîne est refusé.
   */
  private checkSameDevice(signing: RootOfTrust, agreement: RootOfTrust): void {
    const differ = (a: OctetString | undefined, b: OctetString | undefined): boolean =>
      a === undefined || b === undefined ? a !== b : !sameBytes(bytes(a), bytes(b));
    if (
      differ(signing.verifiedBootKey, agreement.verifiedBootKey) ||
      differ(signing.verifiedBootHash, agreement.verifiedBootHash)
    )
      fail(null, 'clés de signature et d’accord attestées par deux appareils différents');
  }

  /** T047 : chaînage explicite, signatures, dates, CA, racine connue ; KeyDescription dans la feuille seulement. */
  private checkChain(role: KeyRole, chain: readonly Buffer[]): ParsedCert[] {
    if (chain.length < 2) fail(role, 'chaîne trop courte');
    if (chain.length > MAX_CHAIN_LENGTH) fail(role, 'chaîne trop longue');
    const certs = chain.map((der, index) => parseCert(der, role, index));
    const now = this.now().getTime();

    certs.forEach((cert, index) => {
      const notBefore = new Date(cert.x509.validFrom).getTime();
      const notAfter = new Date(cert.x509.validTo).getTime();
      if (!(notBefore <= now && now <= notAfter))
        fail(role, `certificat ${index} hors de sa période de validité`);
      const next = certs[index + 1];
      if (next) {
        if (cert.x509.issuer !== next.x509.subject)
          fail(role, `certificat ${index} : émetteur différent du sujet du suivant`);
        if (!next.x509.ca)
          fail(role, `certificat ${index + 1} : pas une autorité (basicConstraints)`);
        if (!cert.x509.verify(next.x509.publicKey))
          fail(role, `certificat ${index} : signature invalide`);
      }
      const extensions = keyDescriptionExtensions(cert);
      if (index === 0 && extensions.length !== 1)
        fail(role, 'feuille sans extension KeyDescription unique');
      if (index > 0 && extensions.length > 0)
        fail(role, `extension KeyDescription hors de la feuille (certificat ${index})`);
    });

    const last = certs[certs.length - 1]!;
    if (!this.roots.some((root) => sameBytes(root, last.x509.raw))) fail(role, 'racine inconnue');
    return certs;
  }

  /** La clé publique de la feuille est la clé annoncée, P-256. */
  private checkLeafKey(role: KeyRole, leafKey: KeyObject, announcedSpki: Buffer): void {
    let announced: KeyObject;
    try {
      announced = createPublicKey({ key: announcedSpki, format: 'der', type: 'spki' });
    } catch {
      return fail(role, 'clé publique annoncée illisible');
    }
    if (
      leafKey.asymmetricKeyType !== 'ec' ||
      leafKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    )
      fail(role, 'clé de la feuille autre que P-256');
    if (!leafKey.equals(announced)) fail(role, 'clé de la feuille différente de la clé annoncée');
  }

  private keyDescription(role: KeyRole, leaf: ParsedCert): KeyDescription {
    const extension = keyDescriptionExtensions(leaf)[0]!;
    try {
      return AsnConvert.parse(bytes(extension.extnValue), KeyDescription);
    } catch {
      return fail(role, 'extension KeyDescription illisible');
    }
  }

  /** T048 : contrôles de R-05 ; autorisations lues dans `teeEnforced` uniquement. */
  private checkKeyDescription(
    role: KeyRole,
    description: KeyDescription,
    expectedChallenge: Buffer,
    purpose: number,
  ): AttestationSecurityLevel[] {
    if (description.attestationVersion < MIN_ATTESTATION_VERSION)
      fail(
        role,
        `attestationVersion ${description.attestationVersion} (KeyMint, Android 12+ exigé)`,
      );
    const attestationLevel = securityLevel(description.attestationSecurityLevel);
    const keymasterLevel = securityLevel(description.keymasterSecurityLevel);
    if (!attestationLevel || !keymasterLevel) fail(role, 'niveau de sécurité logiciel');
    if (!sameBytes(bytes(description.attestationChallenge), expectedChallenge))
      fail(role, 'défi différent du défi attendu');

    const hardware: AuthorizationList = description.teeEnforced;
    if (hardware.origin !== KM_ORIGIN_GENERATED) fail(role, 'origin ≠ GENERATED');
    if (!hardware.purpose || !Array.from(hardware.purpose).includes(purpose))
      fail(role, `purpose ${purpose} absent de la liste matérielle`);
    if (hardware.algorithm !== KM_ALGORITHM_EC) fail(role, 'algorithm ≠ EC');
    if (hardware.ecCurve !== KM_EC_CURVE_P_256) fail(role, 'ecCurve ≠ P-256');

    const rootOfTrust = hardware.rootOfTrust;
    if (!rootOfTrust) fail(role, 'rootOfTrust absent de la liste matérielle');
    if (rootOfTrust.deviceLocked !== true) fail(role, 'appareil déverrouillé');
    if (rootOfTrust.verifiedBootState !== VerifiedBootState.verified)
      fail(role, 'démarrage non vérifié');

    for (const name of ['osPatchLevel', 'vendorPatchLevel', 'bootPatchLevel'] as const) {
      const month = patchMonth(hardware[name]);
      if (month === null) fail(role, `${name} absent ou illisible`);
      if (month < this.settings.minPatchLevel) fail(role, `${name} ${month} trop ancien`);
    }

    this.checkApplication(role, applicationId(role, description));
    return [attestationLevel, keymasterLevel];
  }

  /** Un seul paquet, celui attendu, et toutes ses empreintes de signature dans l'ensemble autorisé. */
  private checkApplication(role: KeyRole, raw: OctetString): void {
    let application: AttestationApplicationId;
    try {
      application = AsnConvert.parse(bytes(raw), AttestationApplicationId);
    } catch {
      return fail(role, 'attestationApplicationId illisible');
    }
    if (application.packageInfos.length !== 1) fail(role, 'un seul paquet attendu');
    const packageName = bytes(application.packageInfos[0]!.packageName).toString('utf8');
    if (packageName !== this.settings.packageName) fail(role, `paquet ${packageName} inattendu`);
    if (application.signatureDigests.length === 0) fail(role, 'aucune empreinte de signature');
    for (const digest of application.signatureDigests)
      if (!this.digests.has(bytes(digest).toString('hex')))
        fail(role, 'empreinte de signature de l’application inconnue');
  }
}
