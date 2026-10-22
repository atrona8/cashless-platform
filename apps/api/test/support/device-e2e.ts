// Outils communs des preuves de bout en bout des terminaux (mission 5a, lot WP18, T083, T084) :
// vérificateur d'attestation RÉEL sur des racines de test (comme enrollment.spec.ts), requêtes des
// personnes et enrôlement par la route sur le serveur HTTPS de test, rafraîchissement signé,
// certificats clients refusés (expiré, hors de l'autorité), nonces d'un terminal, et liste des
// routes de terminal : celles du contrat (`openapi.yaml`) et celles que la garde des terminaux
// protège réellement dans un processus (métadonnées de Nest, jamais une liste en dur).
import 'reflect-metadata';
import { randomBytes, randomInt, randomUUID, sign, webcrypto, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestMethod, type INestApplication, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import * as x509 from '@peculiar/x509';
import { parse } from 'yaml';
import { createAttestationVerifier } from '../../src/attestation/attestation.module';
import type { AttestationVerifier } from '../../src/attestation/attestation.port';
import { loadConfig } from '../../src/config/config';
import { refreshProofMessage } from '../../src/devices/tokens/refresh.dto';
import { createAndroidTestPki, type AndroidTestPki } from './attestation/android';
import { createIosTestPki, type IosTestPki } from './attestation/ios';
import { ownerRows } from './media-fixtures';
import {
  send,
  TestTerminal,
  type EnrollmentBody,
  type EnrollmentBodyOptions,
  type PreparedRequest,
  type RouteServer,
  type TerminalResponse,
} from './test-terminal';

x509.cryptoProvider.set(webcrypto as never);

const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;
const CONTRACT = join(__dirname, '../../../../packages/contracts/openapi.yaml');

/** Adresse propre à un test, dans 198.18.0.0/15 (réservé aux essais) : aucune autre suite. */
export const testAddress = (): string =>
  `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(1, 255)}`;

// ----- Attestation réelle sur des racines de test -----

export interface RealAttestation {
  verifier: AttestationVerifier;
  androidPki: AndroidTestPki;
  iosPki: IosTestPki;
  /** Efface les racines écrites dans le répertoire temporaire. */
  dispose(): void;
}

/**
 * Vérificateur d'attestation réel (Android : WP10 ; iOS : WP11), racines de test générées à
 * l'exécution, liste de révocation vide injectée (aucun réseau). Les objets App Attest de test
 * portent l'AAGUID de production (enrollment.spec.ts).
 */
export async function realAttestation(): Promise<RealAttestation> {
  const androidPki = await createAndroidTestPki();
  const iosPki = await createIosTestPki();
  const dir = mkdtempSync(join(tmpdir(), 'cashless-e2e-attestation-'));
  const androidRoots = join(dir, 'android.pem');
  const iosRoot = join(dir, 'ios.pem');
  writeFileSync(androidRoots, androidPki.rootPem);
  writeFileSync(iosRoot, iosPki.rootPem);
  const verifier = createAttestationVerifier(
    {
      ...loadConfig(),
      androidAttestationRoots: androidRoots,
      iosAppAttestRoot: iosRoot,
      iosAppAttestEnvironment: 'production',
    },
    { revocationSource: async () => ({ entries: {} }) },
  );
  if (verifier.isFake) throw new Error('vérificateur d’attestation réel attendu');
  return {
    verifier,
    androidPki,
    iosPki,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ----- Personnes (back-office) et enrôlement, sans certificat client -----

export interface PersonCallOptions {
  /** `Idempotency-Key` (POST) ; `null` : absente. Défaut : une clé neuve. */
  key?: string | null;
  /** `X-Request-Id` envoyé ; défaut : un identifiant neuf. */
  requestId?: string;
  /** Adresse du client (`X-Forwarded-For`, serveur à un répartiteur de confiance). */
  from?: string;
}

/** Requêtes d'une personne (jeton du faux serveur d'identité) sur le serveur HTTPS de test. */
export function asPerson(server: RouteServer, token: string) {
  const call = (
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: PersonCallOptions,
  ): Promise<TerminalResponse> => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'x-request-id': options.requestId ?? randomUUID(),
    };
    if (options.from) headers['x-forwarded-for'] = options.from;
    const text = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      const key = options.key === undefined ? randomUUID() : options.key;
      if (key !== null) headers['idempotency-key'] = key;
    }
    return send(
      {
        url: new URL(`${server.baseUrl}${path}`),
        method,
        headers,
        body: text,
        cert: null,
        key: null,
      },
      server.serverCaPem,
    );
  };
  return {
    get: (path: string, options: PersonCallOptions = {}) => call('GET', path, undefined, options),
    post: (path: string, body: unknown, options: PersonCallOptions = {}) =>
      call('POST', path, body, options),
  };
}

/** Code d'enrôlement émis par la route pour la personne (rend le code et la réponse). */
export async function issueCode(
  server: RouteServer,
  token: string,
  body: Record<string, unknown>,
  options: PersonCallOptions = {},
): Promise<{ code: string; res: TerminalResponse }> {
  const res = await asPerson(server, token).post(
    '/device-enrollment-codes',
    { app_mode: 'CATALOG_POS', kind: 'POS', personal_phone: false, ...body },
    options,
  );
  if (res.status !== 201) throw new Error(`code d’enrôlement refusé : ${res.status} ${res.text}`);
  return { code: String(res.body.code), res };
}

/**
 * `POST /device-enrollments` depuis `from` (`X-Forwarded-For`) ; en cas de succès, le terminal
 * prend l'identité reçue (comme `TestTerminal.enrollByRoute`). `options.prebuilt` : corps déjà
 * calculé (mesures de latence : clés et attestations de test préparées hors de la mesure).
 */
export async function enrollFrom(
  server: RouteServer,
  terminal: TestTerminal,
  code: string,
  from: string,
  options: EnrollmentBodyOptions & { prebuilt?: EnrollmentBody } = {},
): Promise<TerminalResponse> {
  const body = options.prebuilt ?? (await terminal.enrollmentBody(code, options));
  const res = await send(
    {
      url: new URL(`${server.baseUrl}/device-enrollments`),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': randomUUID(),
        'x-forwarded-for': from,
      },
      body: JSON.stringify(body),
      cert: null,
      key: null,
    },
    server.serverCaPem,
  );
  if (res.status === 201) terminal.adopt(res.body);
  return res;
}

// ----- Rafraîchissement (certificat client et preuve de possession, sans jeton d'appareil) -----

export interface RefreshOptions {
  /** Jeton de rafraîchissement présenté (défaut : le sien). */
  token?: string;
  /** Certificat client : le sien, aucun, ou celui d'un autre terminal. */
  certificate?: 'own' | 'none' | TestTerminal;
  /** Clé qui signe la preuve (défaut : la sienne). */
  signingKey?: KeyObject;
}

/** Requête `POST /device-tokens/refresh` prête à partir (rejouable telle quelle). */
export function prepareRefresh(
  server: RouteServer,
  t: TestTerminal,
  options: RefreshOptions = {},
): PreparedRequest {
  const token = options.token ?? t.refreshToken;
  const nonce = randomBytes(16).toString('base64url');
  const signature = sign('sha256', refreshProofMessage(nonce, t.serial, token), {
    key: options.signingKey ?? t.signing.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const certificate = options.certificate ?? 'own';
  const holder =
    certificate === 'none' ? null : certificate instanceof TestTerminal ? certificate : t;
  return {
    url: new URL(`${server.baseUrl}/device-tokens/refresh`),
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': randomUUID() },
    body: JSON.stringify({
      serial: t.serial,
      refresh_token: token,
      nonce,
      signature: signature.toString('base64'),
    }),
    cert: holder?.certificatePem ?? null,
    key: holder ? holder.signingPrivatePem : null,
  };
}

export const refresh = (
  server: RouteServer,
  t: TestTerminal,
  options: RefreshOptions = {},
): Promise<TerminalResponse> => send(prepareRefresh(server, t, options), server.serverCaPem);

/** Adopte la paire reçue d'un rafraîchissement réussi (comme l'app du terminal). */
export function adoptRefresh(t: TestTerminal, res: TerminalResponse): void {
  if (res.status !== 200) throw new Error(`rafraîchissement refusé : ${res.status} ${res.text}`);
  t.refreshToken = String(res.body.refresh_token);
  t.token = String(res.body.access_token);
}

// ----- Certificats clients refusés à l'étape 1 -----

/**
 * Certificats de la clé de signature du terminal que le serveur doit refuser : `expired`, émis par
 * l'autorité de test des terminaux mais échu ; `foreign`, auto-signé (hors de l'autorité).
 */
export async function refusedCertificates(
  t: TestTerminal,
  authority: { certPem: string; keyPem: string },
): Promise<{ expired: string; foreign: string }> {
  const publicKey = await webcrypto.subtle.importKey('spki', t.signing.spki, EC_P256, true, [
    'verify',
  ]);
  const privateKey = await webcrypto.subtle.importKey(
    'pkcs8',
    t.signing.privateKey.export({ format: 'der', type: 'pkcs8' }),
    EC_P256,
    false,
    ['sign'],
  );
  const caCert = new x509.X509Certificate(authority.certPem);
  const caKey = await webcrypto.subtle.importKey(
    'pkcs8',
    x509.PemConverter.decodeFirst(authority.keyPem),
    EC_P256,
    false,
    ['sign'],
  );
  const extensions = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth]),
  ];
  const serialNumber = () => `01${randomBytes(15).toString('hex')}`;
  const expired = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(),
    subject: `CN=${t.deviceId}, O=${t.operatorId}`,
    issuer: caCert.subject,
    notBefore: new Date(Date.now() - 3 * DAY),
    notAfter: new Date(Date.now() - DAY),
    signingAlgorithm: ECDSA_SHA256,
    publicKey,
    signingKey: caKey,
    extensions,
  });
  const foreign = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serialNumber(),
    name: `CN=${t.deviceId}, O=${t.operatorId}`,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + DAY),
    signingAlgorithm: ECDSA_SHA256,
    keys: { publicKey, privateKey },
    extensions,
  });
  return { expired: expired.toString('pem'), foreign: foreign.toString('pem') };
}

// ----- Lectures en base (propriétaire), bornées au terminal -----

export const noncesOf = async (deviceId: string): Promise<number> =>
  (
    await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM device_request_nonce WHERE device_id = $1',
      [deviceId],
    )
  )[0]!.n;

/** Revendications du jeton d'appareil (lecture seule, sans vérification). */
export const claimsOf = (jwt: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

// ----- Routes de terminal : contrat et processus -----

/** Forme commune d'une route : `GET /media/{}` (paramètres de chemin anonymes, sans `/v1`). */
export const routeKey = (method: string, path: string): string =>
  `${method.toUpperCase()} /${path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (/^(:.+|\{.+\})$/.test(segment) ? '{}' : segment))
    .join('/')}`;

export interface ContractOperation {
  key: string;
  method: string;
  path: string;
  operationId: string;
  /** Schémas de sécurité de chaque entrée `security`. */
  security: string[][];
}

/** Opérations du contrat dont une entrée `security` nomme une preuve de terminal. */
export function contractDeviceOperations(): ContractOperation[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<
      string,
      Record<string, { operationId?: string; security?: Array<Record<string, unknown>> }>
    >;
  };
  const out: ContractOperation[] = [];
  for (const [path, operations] of Object.entries(contract.paths))
    for (const [method, operation] of Object.entries(operations)) {
      if (typeof operation !== 'object' || !operation?.operationId) continue;
      const security = (operation.security ?? []).map((entry) => Object.keys(entry));
      if (!security.some((schemes) => schemes.some((s) => s.startsWith('device')))) continue;
      out.push({
        key: routeKey(method, path),
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId,
        security,
      });
    }
  return out;
}

const asArray = (value: unknown): string[] =>
  value === undefined ? [''] : Array.isArray(value) ? (value as string[]) : [String(value)];

/**
 * Routes que `guard` protège réellement dans l'application (garde posée sur la méthode ou sur le
 * contrôleur), lues dans les métadonnées de Nest : rend `routeKey` → nom du contrôleur.
 */
export function guardedRoutes(
  app: Pick<INestApplication, 'get'>,
  guard: Type<unknown>,
): Map<string, string> {
  const routes = new Map<string, string>();
  const modules = app.get(ModulesContainer, { strict: false });
  for (const module of modules.values())
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (!controller?.prototype) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const guards = [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
        ];
        if (!guards.includes(guard)) continue;
        for (const base of asArray(Reflect.getMetadata(PATH_METADATA, controller)))
          for (const path of asArray(Reflect.getMetadata(PATH_METADATA, handler)))
            routes.set(routeKey(RequestMethod[method], `${base}/${path}`), controller.name);
      }
    }
  return routes;
}
