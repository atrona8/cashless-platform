// Identité réelle du terminal (mission 5a, lot WP12 ; OP-N42 levée ; FR-012 à FR-014, NFR-002 à
// NFR-004 ; research R-01, R-03, R-04 ; décisions DM-01M52R88ZPZEA0NXVSDY9PBXW5 et
// DM-01M59SAEYDXFK29HMMFBTJ96KS). Trois preuves sur CHAQUE requête, toutes obligatoires et liées au
// même terminal, vérifiées dans l'ordre de contracts/device-authentication.md (le premier échec
// arrête) :
//   1. certificat client présenté sur la connexion TLS, reconnu par la seule autorité des terminaux
//      (`socket.authorized`), dans sa validité (revérifiée : une session reprise ne la revérifie
//      pas) ; aucun en-tête de répartiteur n'est cru ;
//   2. jeton d'appareil (`Authorization: Bearer`, `DeviceTokenService.verify`) ;
//   3. terminal relu en base sous le prestataire annoncé par le jeton (jamais cru : inconnu de ce
//      prestataire = refus), avec l'état de la famille `fid` (non opposée à un terminal `REVOKED`,
//      dont la famille est révoquée avec lui : ADR-115) ;
//   4. empreinte du certificat = `device.cert_sha256` ; `cnf.jkt` = empreinte de
//      `device.public_key` ;
//   5. `Content-Digest` = SHA-256 des octets bruts du corps ;
//   6. signature `dev` de la requête par `device.public_key` (profil R-04, request-signature.ts),
//      `@authority` servie par ce déploiement ;
//   6 bis. terminal `REVOKED` dont les trois preuves sont valides → `403 DEVICE_REVOKED`, sans
//      consommer de nonce ni rien écrire (ADR-115, FR-016) : seul le détenteur des clés du
//      terminal apprend qu'il est révoqué ;
//   7. nonce consommé (heure de la base) : rien n'est écrit avant cette étape.
// Refus : étapes 1 à 4 → `null` (la garde répond `401 UNAUTHENTICATED`) ; 5 et 6, rejeu →
// `401 DEVICE_SIGNATURE_INVALID` ; horloge hors tolérance → `400 CLOCK_SKEW_TOO_LARGE` (contrat).
// Le statut `SUSPENDED` (étape 8) est opposé par `DeviceGuard`, après le nonce.
// La réponse ne dit jamais quelle preuve a échoué ; la raison exacte va au journal technique, sans
// jeton, ni signature, ni certificat.
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  type KeyObject,
  type X509Certificate,
} from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { DeviceTokenClaims } from '../device-tokens/device-token.service';
import { p256Thumbprint } from '../device-tokens/device-token.service';
import { ProblemException } from '../errors/problem';
import { requestIdOf } from '../http/request-id.middleware';
import type { DeviceClaims, DeviceDirectory, DeviceIdentityPort } from './device-identity.port';
import type { NonceStore } from './nonce-store';
import {
  authorityAllowed,
  requestParts,
  SignatureProfileError,
  verifyContentDigest,
  verifyRequestSignature,
} from './request-signature';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

/** Ce que la vérification lit des autres briques (injectées ; bouchons en test). */
export interface RealDeviceIdentityDeps {
  tokens: { verify(token: string): Promise<DeviceTokenClaims> };
  directory: Pick<DeviceDirectory, 'findForAuthentication'>;
  nonces: Pick<NonceStore, 'consume'>;
  /** `DEVICE_REQUEST_AUTHORITIES` (config.ts). */
  authorities: readonly string[];
  /** Horloge de la validité du certificat (la fenêtre du nonce, elle, est l'heure de la base). */
  now?: () => Date;
}

/** Étape de contracts/device-authentication.md où la requête est refusée (journal seulement). */
type Step = 1 | 2 | 3 | 4 | 5 | 6 | '6 bis' | 7;

const sameBytes = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/**
 * Étape 1 : certificat client présenté sur la connexion TLS, reconnu par la seule autorité des
 * terminaux (`socket.authorized`), dans sa validité (revérifiée : une session reprise ne la
 * revérifie pas), et son empreinte SHA-256 (DER). Sinon, la raison du refus (journal seulement).
 * Partagée avec la route de rafraîchissement (lot WP15), qui exige le même certificat.
 */
export function peerCertificate(
  req: Request,
  now: Date,
): { certificate: X509Certificate; sha256: Buffer } | { refused: string } {
  const socket = req.socket as Partial<TLSSocket> | undefined;
  if (typeof socket?.getPeerX509Certificate !== 'function')
    return { refused: 'connexion sans TLS' };
  if (socket.authorized !== true)
    return { refused: 'certificat client absent ou hors de l’autorité des terminaux' };
  const certificate = socket.getPeerX509Certificate();
  if (!certificate) return { refused: 'certificat client absent' };
  const at = now.getTime();
  if (
    new Date(certificate.validFrom).getTime() > at ||
    new Date(certificate.validTo).getTime() <= at
  )
    return { refused: 'certificat client hors de sa validité' };
  return { certificate, sha256: createHash('sha256').update(certificate.raw).digest() };
}

/** Octets bruts du corps ; un corps reçu dont les octets n'ont pas été gardés est refusé. */
function rawBodyOf(req: Request): Buffer {
  const raw = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  const length = Number(req.headers['content-length'] ?? '0');
  if (req.headers['transfer-encoding'] !== undefined || length !== 0)
    throw new SignatureProfileError('corps reçu sans ses octets bruts (rawBody)');
  return Buffer.alloc(0);
}

export class RealDeviceIdentity implements DeviceIdentityPort {
  private readonly logger = new Logger('DeviceIdentity');
  private readonly now: () => Date;

  constructor(private readonly deps: RealDeviceIdentityDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async identify(req: Request): Promise<DeviceClaims | null> {
    // 1. Certificat client de la connexion.
    const peer = peerCertificate(req, this.now());
    if ('refused' in peer) return this.refused(req, 1, peer.refused);
    const certSha256 = peer.sha256;

    // 2. Jeton d'appareil.
    const bearer = BEARER.exec(req.header('authorization') ?? '');
    if (!bearer) return this.refused(req, 2, 'jeton d’appareil absent ou mal formé');
    let claims: DeviceTokenClaims;
    try {
      claims = await this.deps.tokens.verify(bearer[1]!);
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      return this.refused(
        req,
        2,
        `jeton refusé (${cause instanceof Error ? cause.name : 'inconnu'})`,
      );
    }
    if (
      !UUID.test(claims.deviceId) ||
      !UUID.test(claims.operatorIdClaim) ||
      !UUID.test(claims.familyId)
    )
      return this.refused(req, 2, 'jeton : identifiants mal formés', claims.deviceId);

    // 3. Terminal relu en base sous le prestataire annoncé, et famille de jetons.
    const found = await this.deps.directory.findForAuthentication(
      claims.operatorIdClaim.toLowerCase(),
      claims.deviceId.toLowerCase(),
      claims.familyId.toLowerCase(),
    );
    if (!found)
      return this.refused(req, 3, 'terminal inconnu du prestataire annoncé', claims.deviceId);
    const { device } = found;
    // Famille révoquée : refus, sauf pour un terminal `REVOKED` (révoquée avec lui) qui doit d'abord
    // prouver qu'il est bien ce terminal (étapes 4 à 6) avant d'apprendre sa révocation (6 bis).
    const revoked = device.status === 'REVOKED';
    if (!found.familyActive && !revoked)
      return this.refused(
        req,
        3,
        'famille de jetons révoquée ou sans jeton vivant',
        claims.deviceId,
      );
    if (!device.publicKey || !device.certSha256)
      return this.refused(req, 3, 'terminal sans clé ni certificat enrôlés', claims.deviceId);

    // 4. Certificat et jeton liés à CE terminal.
    if (!sameBytes(device.certSha256, certSha256))
      return this.refused(req, 4, 'certificat d’un autre terminal', claims.deviceId);
    let publicKey: KeyObject;
    let jkt: string;
    try {
      publicKey = createPublicKey({ key: device.publicKey, format: 'der', type: 'spki' });
      jkt = await p256Thumbprint(device.publicKey);
    } catch {
      return this.refused(req, 4, 'clé de signature enregistrée illisible', claims.deviceId);
    }
    if (!sameBytes(Buffer.from(jkt), Buffer.from(claims.jkt)))
      return this.refused(req, 4, 'jeton lié à une autre clé (cnf.jkt)', claims.deviceId);

    // 5. Corps reçu (et parties couvertes de la requête). 6. Signature.
    const verified = this.signatureStep(
      req,
      5,
      () => {
        const parts = requestParts(req);
        if (!authorityAllowed(parts.authority, this.deps.authorities))
          throw new SignatureProfileError('@authority non servie par ce déploiement');
        verifyContentDigest(parts.contentDigest, rawBodyOf(req));
        return parts;
      },
      device.deviceId,
    );
    const signature = this.signatureStep(
      req,
      6,
      () =>
        verifyRequestSignature(
          verified,
          { signatureInput: req.header('signature-input'), signature: req.header('signature') },
          device.deviceId,
          publicKey,
        ),
      device.deviceId,
    );

    // 6 bis. Terminal révoqué, preuves valides : refus total, rien n'est écrit (pas de nonce).
    if (revoked) {
      this.log(req, '6 bis', 'terminal révoqué', device.deviceId);
      throw new ProblemException('DEVICE_REVOKED');
    }

    // 7. Rejeu et horloge : la seule écriture, après les trois preuves.
    try {
      await this.deps.nonces.consume(
        device.operatorId,
        device.deviceId,
        signature.nonce,
        signature.created,
      );
    } catch (error) {
      if (error instanceof ProblemException)
        this.log(
          req,
          7,
          error.code === 'CLOCK_SKEW_TOO_LARGE' ? 'horloge' : 'rejeu',
          device.deviceId,
        );
      throw error;
    }
    return { deviceId: device.deviceId, operatorId: device.operatorId };
  }

  /** Étapes 5 et 6 : toute erreur du profil devient `401 DEVICE_SIGNATURE_INVALID`. */
  private signatureStep<T>(req: Request, step: 5 | 6, check: () => T, deviceId: string): T {
    try {
      return check();
    } catch (error) {
      if (!(error instanceof SignatureProfileError)) throw error;
      this.log(req, step, error.reason, deviceId);
      throw new ProblemException('DEVICE_SIGNATURE_INVALID');
    }
  }

  private refused(req: Request, step: Step, reason: string, deviceId?: string): null {
    this.log(req, step, reason, deviceId);
    return null;
  }

  private log(req: Request, step: Step, reason: string, deviceId?: string): void {
    this.logger.warn(
      JSON.stringify({
        event: 'device_authentication_refused',
        requestId: requestIdOf(req),
        step,
        reason,
        ...(deviceId ? { claimedDeviceId: deviceId } : {}),
      }),
    );
  }
}
