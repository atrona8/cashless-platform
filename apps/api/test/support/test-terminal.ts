// Terminal de test (mission 5a, lot WP12, T060) : ce que fera l'app terminal (mission 12), sans
// appareil. Deux paires P-256 générées à l'exécution (signature : CSR, certificat mTLS et signature
// des requêtes ; accord : ECDH, enveloppe des mots de passe de bracelet), attestations DE TEST
// (Android : WP10, iOS : WP11) calculées avec les défis de
// `src/attestation/enrollment-challenge.ts`, CSR, enrôlement par la route (`enrollByRoute`, lot
// WP14 ; code émis par `createEnrollmentCode`) ou, pour une application servie en clair, par
// `enroll_device` en propriétaire (`enroll`), jeton d'appareil, et client HTTPS qui présente le
// certificat, pose le jeton et signe chaque requête (profil R-04). Chaque preuve peut être retirée
// ou faussée une à une (matrice de NFR-002). Aucune clé n'est écrite dans le dépôt.
import 'reflect-metadata';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  webcrypto,
  type KeyObject,
} from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { deviceAad, openForRecipient, type EncryptedBlob } from '@cashless/tag-format';
import * as x509 from '@peculiar/x509';
import type { Client } from 'pg';
import {
  androidAgreeChallenge,
  androidSignChallenge,
  iosClientDataHash,
} from '../../src/attestation/enrollment-challenge';
import type { DeviceCaPort } from '../../src/device-ca/device-ca.port';
import type { DeviceTokenService } from '../../src/device-tokens/device-token.service';
import {
  contentDigest,
  normalizeAuthority,
  signRequest,
  type SignedRequestParts,
} from '../../src/device-identity/request-signature';
import {
  androidAttestationChain,
  createAndroidTestPki,
  type AndroidTestPki,
  type KeyDescriptionFields,
} from './attestation/android';
import { appAttestObject, createIosTestPki, type IosTestPki } from './attestation/ios';

type CryptoKey = webcrypto.CryptoKey;
x509.cryptoProvider.set(webcrypto as never);

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

export type TerminalOs = 'ANDROID' | 'IOS';
export type TerminalMode = 'CATALOG_POS' | 'KEYPAD_TPE' | 'TOPUP_DESK';

/** Paire P-256 du terminal, sous les trois formes utiles. */
interface P256Pair {
  privateKey: KeyObject;
  /** SubjectPublicKeyInfo DER. */
  spki: Buffer;
  /** Point non compressé (65 octets). */
  point: Buffer;
  /** Scalaire privé brut (32 octets) : ECDH de `@cashless/tag-format`. */
  scalar: Buffer;
}

function p256Pair(): P256Pair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    privateKey,
    spki: publicKey.export({ format: 'der', type: 'spki' }),
    point: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x!, 'base64url'),
      Buffer.from(jwk.y!, 'base64url'),
    ]),
    scalar: Buffer.from(jwk.d!, 'base64url'),
  };
}

const publicCryptoKey = (spki: Buffer): Promise<CryptoKey> =>
  webcrypto.subtle.importKey('spki', spki, EC_P256, true, ['verify']);

/** Ce que l'enrôlement (route ou fonction) reçoit d'un terminal. */
export interface EnrollmentInput {
  operatorId: string;
  eventId: string;
  posId?: string | null;
  mode?: TerminalMode;
  personalPhone?: boolean;
  /** Statut après l'enrôlement (`set_device_status`, par l'administrateur de test). */
  status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  /** Autorité qui émet le certificat : celle à laquelle le serveur HTTPS de test fait confiance. */
  ca: DeviceCaPort;
}

/** Preuves d'une requête : chacune peut être retirée ou remplacée (matrice de NFR-002). */
export interface ProofOptions {
  /** Certificat client : le sien (défaut), aucun, ou celui d'un autre terminal. */
  certificate?: 'own' | 'none' | TestTerminal;
  /** Jeton : le sien (défaut), aucun (`null`), ou cette valeur. */
  token?: string | null;
  /** Signature : la sienne (défaut), aucune, ou par une autre clé. */
  signature?: 'own' | 'none' | { privateKey: KeyObject };
  /** `created` signé (secondes Unix) ; défaut : maintenant. */
  created?: number;
  /** Nonce signé (base64url) ; défaut : 16 octets aléatoires. */
  nonce?: string;
  /** `@authority` signée, si elle doit différer de l'en-tête `Host` envoyé. */
  signedAuthority?: string;
  /** Composants signés imposés (sinon ceux du profil). */
  components?: readonly string[];
  /** Corps envoyé à la place du corps signé (empreinte et signature restent celles du signé). */
  sentBody?: string;
  /** En-têtes ajoutés ou remplacés après la signature (valeur `null` : en-tête retiré). */
  headers?: Record<string, string | null>;
}

export interface TerminalRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Chemin sous `baseUrl` (ex. `/taps`), requête comprise. */
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

/** Requête prête à partir (rejouable telle quelle : test de rejeu). */
export interface PreparedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
  cert: string | null;
  key: string | null;
}

export interface TerminalResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  text: string;
}

/** Administrateur de test d'un prestataire (auteur des codes et des changements de statut). */
const enrollers = new Map<string, Promise<string>>();

function enrollerOf(db: Client, operatorId: string): Promise<string> {
  let pending = enrollers.get(operatorId);
  if (!pending) {
    pending = (async () => {
      const subject = `enroller-${randomUUID()}`;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO app_user (operator_id, issuer, subject, email, display_name)
         VALUES ($1, 'https://enroller.test', $2, $3, 'Administrateur de test des terminaux')
         RETURNING id`,
        [operatorId, subject, `${subject}@test.local`],
      );
      const userId = rows[0]!.id;
      await db.query(
        `INSERT INTO role_assignment (user_id, role, scope_type, scope_id)
         VALUES ($1, 'OPERATOR_ADMIN', 'OPERATOR', $2)`,
        [userId, operatorId],
      );
      return userId;
    })();
    pending.catch(() => enrollers.delete(operatorId));
    enrollers.set(operatorId, pending);
  }
  return pending;
}

/** Transaction du propriétaire sous le prestataire `operatorId` (fonctions SECURITY DEFINER). */
async function asOperator<T>(db: Client, operatorId: string, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export class TestTerminal {
  readonly signing = p256Pair();
  readonly agreement = p256Pair();
  deviceId = '';
  operatorId = '';
  eventId: string | null = null;
  familyId = '';
  certificatePem = '';
  /** Jeton de rafraîchissement en clair (seule son empreinte est en base). */
  refreshToken = '';
  /** Jeton d'appareil courant (`issueToken`). */
  token = '';
  /** Prochain numéro de `seqKey` (mission 5b) ; à relever si la base impose un plancher. */
  nextSeq = 1;

  constructor(
    readonly os: TerminalOs = 'ANDROID',
    readonly serial = `TEST-${randomUUID().slice(0, 8)}`,
  ) {}

  get signingPrivatePem(): string {
    return this.signing.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  }

  /** CSR PKCS#10 signé par la clé de signature (le sujet demandé n'est jamais recopié, R-09). */
  async csrPem(): Promise<string> {
    const keys = {
      privateKey: await webcrypto.subtle.importKey(
        'pkcs8',
        this.signing.privateKey.export({ format: 'der', type: 'pkcs8' }),
        EC_P256,
        false,
        ['sign'],
      ),
      publicKey: await publicCryptoKey(this.signing.spki),
    };
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `CN=${this.serial}`,
      keys,
      signingAlgorithm: ECDSA_SHA256,
    });
    return csr.toString('pem');
  }

  /**
   * Attestations Android de test : clé d'accord (défi A) PUIS clé de signature (défi S, qui lie le
   * SPKI de la clé d'accord), ordre de `enrollment-challenge.ts`.
   */
  async androidAttestation(
    code: string,
    pki?: AndroidTestPki,
    /** Champs de KeyDescription remplacés dans les deux chaînes (cas refusés). */
    fields?: Partial<KeyDescriptionFields>,
  ): Promise<{ keyChain: Buffer[]; agreementChain: Buffer[]; pki: AndroidTestPki }> {
    const authority = pki ?? (await createAndroidTestPki());
    const agreementChain = await androidAttestationChain(authority, {
      publicKey: await publicCryptoKey(this.agreement.spki),
      purpose: 'AGREE_KEY',
      challenge: androidAgreeChallenge(code, this.serial),
      fields,
    });
    const keyChain = await androidAttestationChain(authority, {
      publicKey: await publicCryptoKey(this.signing.spki),
      purpose: 'SIGN',
      challenge: androidSignChallenge(code, this.serial, this.agreement.spki),
      fields,
    });
    return { keyChain, agreementChain, pki: authority };
  }

  /**
   * Objet App Attest de test : `clientDataHash` = `iosClientDataHash(...)` passé TEL QUEL (nonce =
   * SHA-256(authData ‖ clientDataHash), sans second hachage ; R-06 précisé). La clé App Attest est
   * distincte de la clé de signature (limite OP-N64).
   */
  async iosAttestation(
    code: string,
    pki?: IosTestPki,
  ): Promise<{ keyChain: Buffer[]; pki: IosTestPki }> {
    const authority = pki ?? (await createIosTestPki());
    const appAttestKey = await webcrypto.subtle.generateKey(EC_P256, true, ['sign', 'verify']);
    const object = await appAttestObject({
      publicKey: appAttestKey.publicKey,
      clientDataHash: iosClientDataHash(code, this.serial, this.signing.spki, this.agreement.spki),
      pki: authority,
    });
    return { keyChain: [object], pki: authority };
  }

  /**
   * Enrôlement en propriétaire par les fonctions de la base (route `POST /device-enrollments` :
   * lot WP14) : code émis par `create_device_enrollment_code` (administrateur de test), certificat
   * émis par `ca` à partir du CSR, puis `enroll_device` ; statut final par `set_device_status`.
   */
  async enroll(db: Client, input: EnrollmentInput): Promise<this> {
    const actor = await enrollerOf(db, input.operatorId);
    const codeHash = createHash('sha256').update(randomBytes(32)).digest();
    await asOperator(db, input.operatorId, () =>
      db.query('SELECT create_device_enrollment_code($1, $2, $3, $4, $5, NULL, $6)', [
        codeHash,
        input.eventId,
        input.posId ?? null,
        input.mode ?? null,
        input.personalPhone ?? false,
        actor,
      ]),
    );
    const deviceId = randomUUID();
    const issued = await input.ca.issue(
      new x509.Pkcs10CertificateRequest(await this.csrPem()),
      { deviceId, operatorId: input.operatorId },
      new Date(Date.now() + 30 * DAY),
    );
    this.refreshToken = randomBytes(32).toString('base64url');
    const android = this.os === 'ANDROID';
    await asOperator(db, input.operatorId, () =>
      db.query(
        `SELECT device_id FROM enroll_device($1, $2, $3, '1.0.0-test', $4, $5, $6, $7, $8, $9, $10,
                                             $11, $12)`,
        [
          codeHash,
          this.serial,
          this.os,
          this.signing.spki,
          this.agreement.point,
          issued.sha256,
          issued.notAfter,
          android ? 'ANDROID_KEY_ATTESTATION' : 'IOS_APP_ATTEST',
          android ? 'TRUSTED_ENVIRONMENT' : null,
          createHash('sha256').update(this.refreshToken).digest(),
          new Date(Date.now() + 30 * DAY),
          deviceId,
        ],
      ),
    );
    const { rows } = await db.query<{ family_id: string }>(
      'SELECT family_id FROM device_refresh_token WHERE device_id = $1',
      [deviceId],
    );
    Object.assign(this, {
      deviceId,
      operatorId: input.operatorId,
      eventId: input.eventId,
      familyId: rows[0]!.family_id,
      certificatePem: issued.pem,
    });
    if (input.status && input.status !== 'ACTIVE') await this.setStatus(db, input.status);
    return this;
  }

  /**
   * Corps de `POST /device-enrollments` : clés publiques en SPKI DER canonique, attestations de
   * test calculées sur le code NORMALISÉ (défis de R-08), CSR signé par la clé de signature.
   */
  async enrollmentBody(code: string, options: EnrollmentBodyOptions = {}): Promise<EnrollmentBody> {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    const challengeCode = options.challengeCode ?? normalized;
    const body: EnrollmentBody = {
      enrollment_code: code,
      serial: this.serial,
      os: this.os,
      app_version: '1.0.0-test',
      signing_public_key: this.signing.spki.toString('base64'),
      agreement_public_key: this.agreement.spki.toString('base64'),
      key_attestation_chain: [],
      csr_pem: options.csrPem ?? (await this.csrPem()),
    };
    if (this.os === 'ANDROID') {
      const { keyChain, agreementChain } = await this.androidAttestation(
        challengeCode,
        options.androidPki,
        options.fields,
      );
      body.key_attestation_chain = keyChain.map((der) => der.toString('base64'));
      body.agreement_attestation_chain = agreementChain.map((der) => der.toString('base64'));
    } else {
      const { keyChain } = await this.iosAttestation(challengeCode, options.iosPki);
      body.key_attestation_chain = keyChain.map((der) => der.toString('base64'));
    }
    return body;
  }

  /**
   * Enrôlement par la route (lot WP14) : `POST /device-enrollments` sans certificat ni jeton. En
   * cas de succès (201), le terminal prend son identité de la réponse (certificat, jetons) ; le
   * prestataire, l'événement et la famille sont lus dans le jeton d'appareil.
   */
  async enrollByRoute(
    server: RouteServer,
    code: string,
    options: EnrollmentBodyOptions & { body?: Record<string, unknown> } = {},
  ): Promise<TerminalResponse> {
    const body = { ...(await this.enrollmentBody(code, options)), ...options.body };
    const res = await postJson(server, '/device-enrollments', body);
    if (res.status === 201) this.adopt(res.body);
    return res;
  }

  /** Identité reçue d'un enrôlement réussi. */
  adopt(response: Record<string, unknown>): void {
    const token = String(response.access_token);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
      operator_id: string;
      event_id: string | null;
      fid: string;
    };
    Object.assign(this, {
      deviceId: String(response.device_id),
      certificatePem: String(response.certificate_pem),
      token,
      refreshToken: String(response.refresh_token),
      operatorId: claims.operator_id,
      eventId: claims.event_id,
      familyId: claims.fid,
    });
  }

  /** Changement de statut par l'administrateur de test (`set_device_status`, propriétaire). */
  async setStatus(db: Client, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'): Promise<void> {
    const actor = await enrollerOf(db, this.operatorId);
    await asOperator(db, this.operatorId, () =>
      db.query("SELECT set_device_status($1, $2, 'test', $3)", [this.deviceId, status, actor]),
    );
  }

  /** Jeton d'appareil émis par le service de l'application sous test (même signataire). */
  async issueToken(tokens: DeviceTokenService): Promise<string> {
    const issued = await tokens.issue({
      deviceId: this.deviceId,
      operatorId: this.operatorId,
      serial: this.serial,
      eventId: this.eventId,
      signingSpki: this.signing.spki,
      familyId: this.familyId,
    });
    this.token = issued.token;
    return this.token;
  }

  /** Ouvre l'enveloppe de `POST /media/auth-keys` : rend `PWD‖PACK`. */
  open(blob: EncryptedBlob, uid: Uint8Array): Buffer {
    return openForRecipient({
      recipientPrivateKey: this.agreement.scalar,
      blob,
      aad: deviceAad(this.deviceId, uid),
    });
  }

  /**
   * Clé `<serial>:<seq>` d'une route de terminal (mission 5b, contracts/payments.md) : numéro
   * croissant par terminal, 4 chiffres au moins.
   */
  seqKey(): string {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return `${this.serial}:${String(seq).padStart(4, '0')}`;
  }

  /** Requête signée prête à partir (`send`) : rejouable telle quelle. */
  prepare(baseUrl: string, spec: TerminalRequest, proofs: ProofOptions = {}): PreparedRequest {
    const url = new URL(`${baseUrl}${spec.path}`);
    const body = spec.body === undefined ? '' : JSON.stringify(spec.body);
    const headers: Record<string, string> = {
      'x-request-id': randomUUID(),
      'content-digest': contentDigest(Buffer.from(body, 'utf8')),
    };
    if (body !== '') headers['content-type'] = 'application/json';
    if (spec.idempotencyKey !== undefined) headers['idempotency-key'] = spec.idempotencyKey;
    const token = proofs.token === undefined ? this.token : proofs.token;
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const signature = proofs.signature ?? 'own';
    if (signature !== 'none') {
      const parts: SignedRequestParts = {
        method: spec.method,
        authority: proofs.signedAuthority ?? normalizeAuthority(url.host),
        path: url.pathname,
        query: url.search.replace(/^\?/, ''),
        contentDigest: headers['content-digest']!,
        requestId: headers['x-request-id']!,
        idempotencyKey: spec.idempotencyKey ?? null,
      };
      const signed = signRequest(
        parts,
        {
          created: proofs.created ?? Math.floor(Date.now() / 1000),
          nonce: proofs.nonce ?? randomBytes(16).toString('base64url'),
          keyid: this.deviceId,
        },
        signature === 'own' ? this.signing.privateKey : signature.privateKey,
        proofs.components,
      );
      headers['signature-input'] = signed.signatureInput;
      headers.signature = signed.signature;
    }
    for (const [name, value] of Object.entries(proofs.headers ?? {})) {
      if (value === null) delete headers[name.toLowerCase()];
      else headers[name.toLowerCase()] = value;
    }
    const holder =
      proofs.certificate === 'none'
        ? null
        : proofs.certificate instanceof TestTerminal
          ? proofs.certificate
          : this;
    return {
      url,
      method: spec.method,
      headers,
      body: proofs.sentBody ?? body,
      cert: holder?.certificatePem ?? null,
      key: holder ? holder.signingPrivatePem : null,
    };
  }

  /** Requête signée envoyée tout de suite. */
  request(
    baseUrl: string,
    serverCaPem: string,
    spec: TerminalRequest,
    proofs: ProofOptions = {},
  ): Promise<TerminalResponse> {
    return send(this.prepare(baseUrl, spec, proofs), serverCaPem);
  }
}

/** Serveur HTTPS de test : adresse et autorité de son certificat. */
export interface RouteServer {
  baseUrl: string;
  serverCaPem: string;
}

export interface EnrollmentBodyOptions {
  androidPki?: AndroidTestPki;
  iosPki?: IosTestPki;
  /** Champs de KeyDescription remplacés (Android, cas refusés). */
  fields?: Partial<KeyDescriptionFields>;
  /** Code pris dans les défis, s'il doit différer du code envoyé (défi faux). */
  challengeCode?: string;
  /** CSR envoyé à la place du sien. */
  csrPem?: string;
}

export interface EnrollmentBody {
  enrollment_code: string;
  serial: string;
  os: TerminalOs;
  app_version: string;
  signing_public_key: string;
  agreement_public_key: string;
  key_attestation_chain: string[];
  agreement_attestation_chain?: string[];
  csr_pem: string;
  [field: string]: unknown;
}

/** `POST` JSON sans certificat client (personne ou terminal pas encore enrôlé). */
export function postJson(
  server: RouteServer,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<TerminalResponse> {
  const url = new URL(`${server.baseUrl}${path}`);
  return send(
    {
      url,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      cert: null,
      key: null,
    },
    server.serverCaPem,
  );
}

/** Code d'enrôlement émis par la route (`POST /device-enrollment-codes`) pour la personne. */
export async function createEnrollmentCode(
  server: RouteServer,
  personToken: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await postJson(
    server,
    '/device-enrollment-codes',
    { app_mode: 'CATALOG_POS', kind: 'POS', personal_phone: false, ...body },
    { authorization: `Bearer ${personToken}`, 'idempotency-key': randomUUID() },
  );
  if (res.status !== 201) throw new Error(`code d’enrôlement refusé : ${res.status} ${res.text}`);
  return String(res.body.code);
}

/** Envoie une requête préparée sur une connexion TLS neuve (aucune reprise de session). */
export function send(prepared: PreparedRequest, serverCaPem: string): Promise<TerminalResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: prepared.url.hostname,
        port: prepared.url.port,
        path: `${prepared.url.pathname}${prepared.url.search}`,
        method: prepared.method,
        headers: { ...prepared.headers, 'content-length': Buffer.byteLength(prepared.body) },
        ca: serverCaPem,
        servername: prepared.url.hostname,
        agent: false,
        ...(prepared.cert && prepared.key ? { cert: prepared.cert, key: prepared.key } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try {
            body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
          } catch {
            body = {};
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(prepared.body);
  });
}
