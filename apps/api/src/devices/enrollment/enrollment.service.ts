// Enrôlement d'un terminal (contracts/enrollment.md, étapes 1 à 10 ; lot WP14). Route sans compte :
// les étapes 1 à 8 ne lisent et n'écrivent rien qui consomme le code ; l'étape 9 (`enroll_device`,
// SECURITY DEFINER, une transaction) est la seule écriture de l'enrôlement. Un certificat émis à
// l'étape 8 pour un enrôlement qui échoue ensuite n'est jamais accepté : son empreinte n'est
// enregistrée nulle part.
//
// Essais et audit (R-16, ADR-117) : TOUT refus (validation, limite, code inconnu, utilisé, expiré,
// mode, attestation, `serial`) écrit son essai et sa ligne `DEVICE_ENROLLMENT_REFUSED` ensemble
// (`record_enrollment_refusal`, migration 0027) dans une transaction distincte de celle de
// l'enrôlement, qui a été annulée : chaîne du prestataire si le code est connu en base (même
// expiré ou utilisé), sinon chaîne de la plateforme. Au-delà d'une limite, la base n'écrit qu'un
// essai et un audit RATE_LIMITED par fenêtre. Une réussite écrit son essai et `DEVICE_ENROLLED`
// DANS la transaction de l'enrôlement (aucun terminal sans sa ligne d'audit). Les limites (refus
// seuls, tout code bien formé) sont lues avant l'étape 1 (`enrollment_attempts_exceeded`) : le
// code et son empreinte se lisent dans le corps brut, et un corps invalide reçoit aussi 429. La
// base revérifie les limites sous verrou en écrivant le refus (migration 0030) : une rafale
// simultanée qui a passé ce contrôle n'écrit pas plus d'une trace au-delà ; la limite par adresse
// vaut pour un /64 en IPv6.
//
// Secrets : le code saisi n'est jamais journalisé ni écrit (l'empreinte HMAC-SHA256 à clé seule
// part en base), ni le jeton de rafraîchissement (empreinte SHA-256), ni le jeton d'appareil.
// Code inconnu et code utilisé suivent le même chemin (même refus à l'étape 3, mêmes requêtes),
// donc la même réponse en un temps comparable (NFR-006).
import { randomUUID, X509Certificate } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ProblemCode } from '@cashless/contracts';
import * as x509 from '@peculiar/x509';
import { AttestationError, type AttestationVerifier } from '../../attestation/attestation.port';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { TenantTx } from '../../db/tenant-tx';
// `device-ca.port` règle aussi le fournisseur WebCrypto de `@peculiar/x509`.
import { DEVICE_CA, DeviceCsrError, type DeviceCaPort } from '../../device-ca/device-ca.port';
import { DeviceTokenService } from '../../device-tokens/device-token.service';
import { enrollmentCodeHash } from '../../enrollment-code/enrollment-code';
import { ProblemException } from '../../errors/problem';
import { resolveProblem } from '../../errors/problem.filter';
import { ATTESTATION_VERIFIER } from '../../security/port-tokens';
import {
  checkKeys,
  enrollmentCodeOf,
  parseEnrollment,
  type EnrollmentRequest,
} from './enrollment.dto';
import { newRefreshToken, refreshTokenHash } from './refresh-token';

const DAY_MS = 86_400_000;
/** Fenêtre des limites R-16 : un refus 429 invite à réessayer dans l'heure. */
const RETRY_AFTER_SECONDS = 3600;

/** Valeurs de `device_enrollment_attempt.result` par refus du contrat. */
const ATTEMPT_RESULTS: Partial<Record<ProblemCode, string>> = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  ENROLLMENT_CODE_INVALID: 'CODE_INVALID',
  ENROLLMENT_CODE_EXPIRED: 'CODE_EXPIRED',
  DEVICE_MODE_NOT_ALLOWED: 'MODE_NOT_ALLOWED',
  ATTESTATION_FAILED: 'ATTESTATION_FAILED',
  DEVICE_SERIAL_IN_USE: 'SERIAL_IN_USE',
};

export interface EnrollmentResponse {
  device_id: string;
  serial: string;
  certificate_pem: string;
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  next_seq: number;
  server_time: string;
}

/** Ce que l'essai en cours a appris, pour la trace d'un refus. */
interface Attempt {
  /** Empreinte de tout code bien formé, connu ou non (la base retrouve le prestataire). */
  codeHash: Buffer | null;
  address: string;
  serial: string | null;
  os: string | null;
  /** Raison interne d'un refus d'attestation ou de CSR (audit seulement, jamais au client). */
  reason: string | null;
}

interface CodeRow {
  operator_id: string;
  event_id: string;
  pos_id: string | null;
  app_mode: string;
  personal_phone: boolean;
}

const attestationFailed = () => new ProblemException('ATTESTATION_FAILED');

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    private readonly tokens: DeviceTokenService,
    @Inject(APP_CONFIG)
    private readonly config: Pick<
      AppConfig,
      'enrollmentCodeHmacKey' | 'deviceCertValidityDays' | 'deviceRefreshTokenTtlDays'
    >,
    @Inject(ATTESTATION_VERIFIER) private readonly attestation: AttestationVerifier,
    @Inject(DEVICE_CA) private readonly ca: DeviceCaPort,
  ) {}

  /** `context.origin` : adresse de connexion (`req.ip`, TRUST_PROXY_HOPS = 0 en production). */
  async enroll(raw: unknown, context: AuditContext, address: string): Promise<EnrollmentResponse> {
    const code = enrollmentCodeOf(raw);
    const attempt: Attempt = {
      codeHash: code === null ? null : enrollmentCodeHash(code, this.config.enrollmentCodeHmacKey),
      address,
      serial: null,
      os: null,
      reason: null,
    };
    try {
      return await this.steps(raw, attempt, context);
    } catch (error) {
      await this.recordRefusal(error, attempt, context);
      throw error;
    }
  }

  private async steps(
    raw: unknown,
    attempt: Attempt,
    context: AuditContext,
  ): Promise<EnrollmentResponse> {
    // Limites R-16 d'abord (ADR-117) : au-delà, même un corps invalide reçoit 429 et la base
    // n'écrit qu'une trace par fenêtre ; aucune requête ne force une écriture sans borne.
    await this.checkLimits(attempt);
    // 1. Corps ; 2. clés.
    const input = parseEnrollment(raw);
    attempt.serial = input.serial;
    attempt.os = input.os;
    const { agreementPoint } = checkKeys(input);
    // 3. Code (lecture seule) et 4. mode, par la fonction de la base.
    const codeRow = await this.checkCode(attempt, input);
    // 5. Défis et 6. attestation (le vérificateur recalcule les défis de R-08).
    const verified = await this.verifyAttestation(attempt, input, input.code!);
    // 7. CSR : clé = signing_public_key, ECDSA-SHA256, signature valide.
    const csr = await this.checkCsr(attempt, input);
    // 8. Certificat (sujet imposé), jeton de rafraîchissement.
    const deviceId = randomUUID();
    const now = new Date();
    let certificate;
    try {
      certificate = await this.ca.issue(
        csr,
        { deviceId, operatorId: codeRow.operator_id },
        certificateNotAfter(now, this.config.deviceCertValidityDays, this.ca.caCertificatesPem()),
      );
    } catch (error) {
      if (!(error instanceof DeviceCsrError)) throw error;
      attempt.reason = `certificat : ${error.reason}`;
      throw attestationFailed();
    }
    const refreshToken = newRefreshToken();
    // 9. Enrôlement atomique ; 10. jeton d'appareil signé avant la validation (un échec annule).
    return this.tx.run(codeRow.operator_id, async (client) => {
      const enrolled = (
        await client.query<{ device_id: string; next_seq: bigint }>(
          `SELECT device_id, next_seq
             FROM enroll_device($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            attempt.codeHash,
            input.serial,
            input.os,
            input.appVersion,
            input.signingSpki,
            agreementPoint,
            certificate.sha256,
            certificate.notAfter,
            verified.kind,
            verified.securityLevel,
            refreshTokenHash(refreshToken),
            new Date(now.getTime() + this.config.deviceRefreshTokenTtlDays * DAY_MS),
            deviceId,
          ],
        )
      ).rows[0]!;
      const device = (
        await client.query<{ family_id: string; enrollment_code_id: string }>(
          `SELECT t.family_id, d.enrollment_code_id
             FROM device d JOIN device_refresh_token t ON t.device_id = d.id
            WHERE d.id = $1 AND d.operator_id = $2 AND t.revoked_at IS NULL`,
          [deviceId, codeRow.operator_id],
        )
      ).rows[0]!;
      const token = await this.tokens.issue({
        deviceId,
        operatorId: codeRow.operator_id,
        serial: input.serial,
        eventId: codeRow.event_id,
        signingSpki: input.signingSpki,
        familyId: device.family_id,
      });
      const nextSeq = Number(enrolled.next_seq);
      await client.query('SELECT record_enrollment_attempt($1, $2::inet, $3)', [
        attempt.codeHash,
        attempt.address,
        'ENROLLED',
      ]);
      await this.audit.record(client, {
        ...context,
        operatorId: codeRow.operator_id,
        action: 'DEVICE_ENROLLED',
        objectType: 'device',
        objectId: deviceId,
        after: {
          enrollment_code_id: device.enrollment_code_id,
          serial: input.serial,
          os: input.os,
          app_mode: codeRow.app_mode,
          attestation_kind: verified.kind,
          attestation_security_level: verified.securityLevel,
          cert_not_after: certificate.notAfter.toISOString(),
          next_seq: nextSeq,
        },
      });
      return {
        device_id: deviceId,
        serial: input.serial,
        certificate_pem: certificate.pem,
        access_token: token.token,
        token_type: 'Bearer' as const,
        expires_in: token.expiresIn,
        refresh_token: refreshToken,
        next_seq: nextSeq,
        server_time: new Date().toISOString(),
      };
    });
  }

  /**
   * Limites R-16 (429) : 10 refus du code (tout code bien formé, connu ou non) ou 30 refus de
   * l'adresse dans l'heure ; les réussites ne comptent pas (ADR-117).
   */
  private async checkLimits(attempt: Attempt): Promise<void> {
    const limited = await this.tx.withoutTenant(
      async (client) =>
        (
          await client.query<{ exceeded: boolean }>(
            'SELECT enrollment_attempts_exceeded($1, $2::inet) AS exceeded',
            [attempt.codeHash, attempt.address],
          )
        ).rows[0]!.exceeded,
    );
    if (limited)
      throw new ProblemException('RATE_LIMITED', {
        headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
      });
  }

  /** Étapes 3 et 4 : refus CL025 à CL027 de la base, rien d'écrit. */
  private checkCode(attempt: Attempt, input: EnrollmentRequest): Promise<CodeRow> {
    return this.tx.withoutTenant(async (client) => {
      // Saisie mal formée : empreinte nulle, refusée par la base comme un code inconnu (CL025).
      const { rows } = await client.query<CodeRow>(
        `SELECT operator_id, event_id, pos_id, app_mode, personal_phone
           FROM check_device_enrollment_code($1, $2)`,
        [attempt.codeHash, input.os],
      );
      return rows[0]!;
    });
  }

  private async verifyAttestation(attempt: Attempt, input: EnrollmentRequest, code: string) {
    try {
      return await this.attestation.verify({
        os: input.os,
        keyAttestationChain: input.keyAttestationChain,
        agreementAttestationChain: input.agreementAttestationChain,
        signingPublicKey: input.signingSpki,
        agreementPublicKey: input.agreementSpki,
        enrollmentCode: code,
        serial: input.serial,
      });
    } catch (error) {
      if (!(error instanceof AttestationError)) throw error;
      attempt.reason = error.reason;
      throw attestationFailed();
    }
  }

  /**
   * Étape 7 (R-09, relecture WP09) : PKCS#10 lisible, signé en ECDSA-SHA256 (tout autre
   * algorithme refusé, ECDSA-SHA1 compris), clé publique = `signing_public_key`, signature valide.
   */
  private async checkCsr(attempt: Attempt, input: EnrollmentRequest) {
    const refuse = (reason: string): never => {
      attempt.reason = `CSR : ${reason}`;
      throw attestationFailed();
    };
    let csr: x509.Pkcs10CertificateRequest;
    try {
      csr = new x509.Pkcs10CertificateRequest(input.csrPem);
    } catch {
      return refuse('illisible');
    }
    const algorithm = csr.signatureAlgorithm as { name?: string; hash?: { name?: string } };
    if (algorithm.name !== 'ECDSA' || algorithm.hash?.name !== 'SHA-256')
      refuse('signature ECDSA-SHA256 attendue');
    if (!Buffer.from(csr.publicKey.rawData).equals(input.signingSpki))
      refuse('clé différente de signing_public_key');
    let signed = false;
    try {
      signed = await csr.verify();
    } catch {
      signed = false;
    }
    if (!signed) refuse('signature invalide');
    return csr;
  }

  /**
   * Trace d'un refus, hors de la transaction annulée ; une erreur 5xx n'est pas un essai. Essai et
   * audit sont écrits ensemble par la base (`record_enrollment_refusal`), qui choisit la chaîne
   * d'audit d'après l'empreinte : prestataire du code s'il est connu, sinon plateforme. Ni code,
   * ni empreinte, ni attestation dans l'audit : la raison, l'adresse, le terminal annoncé.
   */
  private async recordRefusal(
    error: unknown,
    attempt: Attempt,
    context: AuditContext,
  ): Promise<void> {
    const problem = resolveProblem(error);
    const result = ATTEMPT_RESULTS[problem.code];
    if (!result || problem.status >= 500) return;
    try {
      await this.tx.withoutTenant((client) =>
        client.query(
          'SELECT record_enrollment_refusal($1, $2::inet, $3, $4, $5, $6, $7, $8::uuid)',
          [
            attempt.codeHash,
            attempt.address,
            result,
            attempt.reason?.slice(0, 200) ?? null,
            attempt.serial,
            attempt.os,
            context.origin,
            context.requestId || null,
          ],
        ),
      );
    } catch (recordError) {
      process.stderr.write(
        `${JSON.stringify({
          level: 'error',
          requestId: context.requestId,
          code: 'ENROLLMENT_ATTEMPT_NOT_RECORDED',
          message: recordError instanceof Error ? recordError.message : String(recordError),
        })}\n`,
      );
    }
  }
}

/**
 * Fin de validité du certificat (relecture WP09) : `DEVICE_CERT_VALIDITY_DAYS` (730 jours au plus,
 * borne de la configuration), jamais au-delà de la fin de validité de l'autorité (la plus proche
 * des certificats de la chaîne). Autorité expirée ou sans certificat : refus d'émettre.
 */
export function certificateNotAfter(now: Date, validityDays: number, caPems: string[]): Date {
  if (caPems.length === 0)
    throw new Error('Autorité des terminaux sans certificat : aucun certificat ne peut être émis');
  const wanted = now.getTime() + validityDays * DAY_MS;
  const authorityEnd = Math.min(
    ...caPems.map((pem) => Date.parse(new X509Certificate(pem).validTo)),
  );
  if (!(authorityEnd > now.getTime()))
    throw new Error('Autorité des terminaux expirée : aucun certificat ne peut être émis');
  return new Date(Math.min(wanted, authorityEnd));
}
