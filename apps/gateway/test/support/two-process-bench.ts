// Banc de bout en bout à DEUX PROCESSUS et DEUX BASES (research R-26, quickstart § 4 à 7) :
//   (a) le central public (API HTTPS réelle, personnes par le faux serveur d'identité de l'API) et
//   (b) le processus `edge` (TLS mutuel, autorité `EDGE_CA`), tous deux dans le processus Jest, sur
// la base
//       `cashless_m8_central_<id>` ;
//   (c) la passerelle, en PROCESSUS ENFANT (HTTPS réel, TLS 1.3), sur la base
// `cashless_m8_edge_<id>` ;
//   (d) le relais TCP coupable entre (c) et (b).
// Les aides de l'API (monde de paiements, terminaux, personnes) sont importées pour le TEST
// seulement.
// Chemin d'inscription : `gateway request` (clés du faux du port, fichier 0600) puis `tools/edge-
// admin
// register` puis `gateway enroll`. Rien n'est écrit dans le dépôt ; certificats générés à la volée.
import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createHash,
  KeyObject,
  randomBytes,
  randomUUID,
  sign as nodeSign,
  webcrypto,
  X509Certificate,
} from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import { Client } from 'pg';
import { FakeEdgeCa } from '../../../api/src/edge/ca/fake-edge-ca';
import { PaymentWorld } from '../../../api/test/integration/payments/payments-fixtures';
import { edgeTls, startEdge, type RunningEdge } from '../../../api/test/support/edge-fixtures';
import { withOwner } from '../../../api/test/support/db';
import type { TestPerson } from '../../../api/test/support/fake-idp';
import type { PayTerminal } from '../../../api/test/integration/payments/payments-fixtures';
import {
  send,
  type TerminalRequest,
  type TerminalResponse,
} from '../../../api/test/support/test-terminal';
import { refreshProofMessage } from '../../src/device/dto';
import { orderBytes, type OrderPayload } from '../../src/authority/site-order';
import { main as edgeAdminMain } from '../../../../tools/edge-admin/src/main';
import { realDeps } from '../../../../tools/edge-admin/src/main';
import {
  createCentralDatabase,
  createEdgeDatabase,
  type CentralDatabase,
  type Cluster,
  type EdgeDatabase,
} from './disposable-databases';
import { TcpRelay } from './tcp-relay';

x509.cryptoProvider.set(webcrypto as never);
const GATEWAY_DIR = join(__dirname, '..', '..');
const TSX = require.resolve('tsx/cjs');
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Attend qu'une condition devienne vraie (sondage), échoue avec `what` au bout de `timeoutMs`. */
export async function until<T>(
  what: string,
  probe: () => Promise<T | null | false | undefined> | T | null | false | undefined,
  timeoutMs = 30_000,
  stepMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`délai dépassé : ${what}${last ? ` (${String(last)})` : ''}`);
    }
    await sleep(stepMs);
  }
}

/** Processus enfant de la passerelle : sortie capturée, arrêt par signal, sortie observable. */
export class GatewayProcess {
  stdout = '';
  stderr = '';
  exit: { code: number | null; signal: string | null } | null = null;
  readonly closed: Promise<void>;
  constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', (c: Buffer) => (this.stdout += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (this.stderr += c.toString()));
    this.closed = new Promise((resolve) =>
      child.on('close', (code, signal) => {
        this.exit = { code, signal };
        resolve();
      }),
    );
  }
  get output(): string {
    return `${this.stdout}\n${this.stderr}`;
  }
  get pid(): number | undefined {
    return this.child.pid;
  }
  async listening(timeoutMs = 90_000): Promise<number> {
    return until(
      `passerelle en écoute (${this.stderr.slice(-300)})`,
      () => {
        if (this.exit) throw new Error(`passerelle arrêtée : ${this.stderr.slice(-500)}`);
        const match = /GATEWAY listening \w+ port=(\d+)/.exec(this.stdout);
        return match ? Number(match[1]) : null;
      },
      timeoutMs,
      50,
    );
  }
  async kill(signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
    if (this.exit) return;
    this.child.kill(signal);
    await this.closed;
  }
}

export interface BenchOptions {
  /** Retard du relais (LAN simulé) en ms. */
  relayDelayMs?: number;
  /** Variables de plus pour la passerelle (ex. `EDGE_FAILPOINT`). */
  gatewayEnv?: Record<string, string>;
  /** Ne démarre pas la passerelle (la suite la démarre elle-même). */
  startGateway?: boolean;
  /** Catalogue, bracelets, etc. : `PaymentWorld` (vrai central, vrais terminaux). */
  withPayments?: boolean;
  /** Cluster PostgreSQL de la base LOCALE (défaut : celui du poste) ; ex. conteneur jetable. */
  edgeCluster?: Cluster;
}

export interface SiteKey {
  holder: string;
  privateKey: webcrypto.CryptoKey;
  publicSpkiB64: string;
}

async function siteKey(holder: string): Promise<SiteKey> {
  const keys = await webcrypto.subtle.generateKey(EC, true, ['sign', 'verify']);
  return {
    holder,
    privateKey: keys.privateKey,
    publicSpkiB64: Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString(
      'base64',
    ),
  };
}

const b64 = (der: ArrayBuffer): string =>
  (
    Buffer.from(der)
      .toString('base64')
      .match(/.{1,64}/g) ?? []
  ).join('\n');

export class TwoProcessBench {
  id = process.env.M8_E2E_ID ?? randomUUID().slice(0, 8);
  centralDb!: CentralDatabase;
  edgeDb!: EdgeDatabase;
  world!: PaymentWorld;
  edge!: RunningEdge;
  relay!: TcpRelay;
  gateway: GatewayProcess | null = null;
  gatewayId = '';
  gwPort = 0;
  adminPort = 0;
  dir = '';
  siteKeys: [SiteKey, SiteKey] | null = null;
  edgeCa!: FakeEdgeCa;
  env: Record<string, string> = {};
  /** Sorties capturées de tous les processus enfants (canari : « sortie des enfants »). */
  readonly childOutputs: string[] = [];
  private readonly extraGatewayEnv: Record<string, string>;

  private constructor(private readonly options: BenchOptions) {
    this.extraGatewayEnv = options.gatewayEnv ?? {};
  }

  get gwBaseUrl(): string {
    return `https://127.0.0.1:${this.gwPort}/v1`;
  }
  get centralBaseUrl(): string {
    return this.world.api.baseUrl;
  }
  get serverCa(): string {
    return this.world.api.tls.serverCaPem;
  }
  get ledgerId(): string {
    return this.world.w.ids.ledgerA;
  }
  get eventId(): string {
    return this.world.w.ids.eventA;
  }
  get operatorId(): string {
    return this.world.w.ops.a;
  }

  static async start(options: BenchOptions = {}): Promise<TwoProcessBench> {
    const bench = new TwoProcessBench(options);
    await bench.boot();
    return bench;
  }

  private async boot(): Promise<void> {
    this.dir = mkdtempSync(join(tmpdir(), 'm8-bench-'));
    this.centralDb = await createCentralDatabase(this.id);
    this.edgeDb = await createEdgeDatabase(this.id, this.options.edgeCluster);
    this.world = await PaymentWorld.create();
    const { tls } = await edgeTls();
    this.edgeCa = await FakeEdgeCa.inMemory();
    const edgeCaFile = join(this.dir, 'edge-ca.crt');
    writeFileSync(edgeCaFile, this.edgeCa.caCertPem(), { mode: 0o600 });
    this.edge = await startEdge({ EDGE_CA_CERT_FILE: edgeCaFile });
    this.relay = await TcpRelay.start({ target: { host: '127.0.0.1', port: this.edge.port } });
    if (this.options.relayDelayMs) this.relay.delayMs(this.options.relayDelayMs);
    this.gwPort = await freePort();
    this.adminPort = await freePort();
    void tls;
    await this.enroll();
    await this.seedIdentityKey();
    if (this.options.startGateway !== false) await this.startGateway();
  }

  /**
   * Copie locale de la clé publique du faux serveur d'identité du banc (`edge_identity_key`) : la passerelle de
   * production la tient d'une adresse JWKS en HTTPS (`GATEWAY_IDENTITY_JWKS_URL`) ; le banc pose la même ligne.
   * Banc seulement : le faux d'identité n'existe pas en production.
   */
  private async seedIdentityKey(): Promise<void> {
    const idp = this.world.w.idp;
    await this.edgeDb.pool.query(
      `INSERT INTO edge_identity_key (kid, jwk, issuer) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (kid) DO NOTHING`,
      [String(idp.publicJwk.kid), JSON.stringify(idp.publicJwk), idp.config.issuer],
    );
  }

  /** Environnement de la passerelle (rien d'hérité sauf PATH). */
  gatewayEnvironment(extra: Record<string, string> = {}): Record<string, string> {
    // Profilage (T114) : `M8_GATEWAY_NODE_OPTIONS` (ex. `--require /chemin/pg-timing.cjs`) et
    // `PROF_OUT` sont transmis à la passerelle ; absents, rien ne change.
    const profiling: Record<string, string> = {};
    for (const [from, to] of [
      ['M8_GATEWAY_NODE_OPTIONS', 'NODE_OPTIONS'],
      ['PROF_OUT', 'PROF_OUT'],
    ] as const)
      if (process.env[from]) profiling[to] = process.env[from]!;
    return { ...this.env, ...this.extraGatewayEnv, ...profiling, ...extra };
  }

  private async enroll(): Promise<void> {
    const { tls } = await edgeTls();
    const keyFile = join(this.dir, 'dev-keys.json');
    // Certificat TLS client (clé en fichier 0600, décision 32) émis par l'autorité des passerelles.
    const clientKeys = await webcrypto.subtle.generateKey(EC, true, ['sign', 'verify']);
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=passerelle-banc',
      keys: clientKeys,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    });
    const clientCertPem = await this.edgeCa.issue(csr.toString('pem'), `GW-${this.id}`);
    const clientCertFile = join(this.dir, 'client.crt');
    const clientKeyFile = join(this.dir, 'client.key');
    writeFileSync(clientCertFile, clientCertPem, { mode: 0o600 });
    const pkcs8 = b64(await webcrypto.subtle.exportKey('pkcs8', clientKeys.privateKey));
    writeFileSync(
      clientKeyFile,
      `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`,
      { mode: 0o600 },
    );
    this.env = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'test',
      GATEWAY_DATABASE_URL: this.edgeDb.url,
      GATEWAY_CENTRAL_URL: `https://127.0.0.1:${this.relay.port}/v1`,
      GATEWAY_LISTEN_PORT: String(this.gwPort),
      GATEWAY_ADMIN_PORT: String(this.adminPort),
      GATEWAY_TLS_CERT_FILE: tls.tlsCertFile,
      GATEWAY_TLS_KEY_FILE: tls.tlsKeyFile,
      GATEWAY_DEVICE_CA_FILE: tls.deviceCaCertFile,
      GATEWAY_CENTRAL_CLIENT_CERT_FILE: clientCertFile,
      GATEWAY_CENTRAL_CLIENT_KEY_FILE: clientKeyFile,
      GATEWAY_REQUEST_AUTHORITY: `127.0.0.1:${this.gwPort}`,
      HARDWARE_KEYSTORE: 'fake',
      GATEWAY_DEV_KEY_FILE: keyFile,
      GATEWAY_PURGE_MARKER_FILE: join(this.dir, 'purge.marker'),
      GATEWAY_IDENTITY_ISSUER: this.world.w.idp.config.issuer,
      GATEWAY_IDENTITY_AUDIENCE: this.world.w.idp.config.audience,
    };
    const serial = `GW-${this.id}`;
    const requestFile = join(this.dir, 'request.json');
    await this.runOffline([
      'request',
      '--serial',
      serial,
      '--role',
      'PRIMARY',
      '--out',
      requestFile,
    ]);
    this.siteKeys = [await siteKey('Responsable A'), await siteKey('Responsable B')];
    const enrollmentFile = join(this.dir, 'enrolment.json');
    const centralCaFile = join(this.dir, 'central-ca.crt');
    writeFileSync(centralCaFile, tls.serverCaPem);
    const lanUrl = (JSON.parse(readFileSync(requestFile, 'utf8')) as { lan_url: string }).lan_url;
    const out: string[] = [];
    const err: string[] = [];
    const adminEnv = {
      NODE_ENV: 'test',
      EDGE_CA: 'fake',
      DATABASE_URL_EDGEADMIN: this.centralDb.urls.edgeadmin,
    };
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    const code = await edgeAdminMain(
      [
        'register',
        '--request',
        requestFile,
        '--operator',
        this.operatorId,
        '--event',
        this.eventId,
        '--ledger',
        this.ledgerId,
        '--serial',
        serial,
        '--role',
        'PRIMARY',
        '--lan-url',
        lanUrl,
        '--by',
        'Awa Diop',
        '--out',
        enrollmentFile,
        '--central-url',
        `https://127.0.0.1:${this.relay.port}/v1`,
        '--central-ca-file',
        centralCaFile,
        '--device-ca-file',
        tls.deviceCaCertFile,
        '--site-key-a',
        this.siteKeys[0].publicSpkiB64,
        '--site-holder-a',
        this.siteKeys[0].holder,
        '--site-key-b',
        this.siteKeys[1].publicSpkiB64,
        '--site-holder-b',
        this.siteKeys[1].holder,
      ],
      adminEnv,
      io,
      (env, i) => ({ ...realDeps(env, i), ca: async () => this.edgeCa }),
    );
    if (code !== 0) throw new Error(`edge-admin register : code ${code} ${err.join(' ')}`);
    // Amorçage du banc seulement : le certificat inscrit est celui de la clé `batch` du port (sans
    // fichier de
    // clé) ; la clé TLS client vit en fichier jusqu'à la mission 12b (décision 32, OP-N113). Le
    // banc inscrit
    // donc l'empreinte du certificat TLS client, émis par la même autorité.
    const digest = createHash('sha256').update(new X509Certificate(clientCertPem).raw).digest();
    this.gatewayId = await withOwner(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `UPDATE edge_gateway SET cert_sha256 = $1 WHERE serial = $2 RETURNING id`,
        [digest, serial],
      );
      return rows[0]!.id;
    });
    await this.runOffline(['enroll', enrollmentFile]);
  }

  /** `request` et `enroll` : commandes hors service de la passerelle, en processus enfant. */
  private async runOffline(args: string[]): Promise<void> {
    const child = spawn(process.execPath, ['--require', TSX, 'src/main.ts', ...args], {
      cwd: GATEWAY_DIR,
      env: this.env,
    });
    const proc = new GatewayProcess(child);
    await proc.closed;
    this.childOutputs.push(proc.output);
    if (proc.exit?.code !== 0) throw new Error(`gateway ${args[0]} : ${proc.output}`);
  }

  async startGateway(extra: Record<string, string> = {}): Promise<GatewayProcess> {
    const child = spawn(process.execPath, ['--require', TSX, 'src/main.ts'], {
      cwd: GATEWAY_DIR,
      env: this.gatewayEnvironment(extra),
    });
    const proc = new GatewayProcess(child);
    this.gateway = proc;
    void proc.closed.then(() => this.childOutputs.push(proc.output));
    await proc.listening();
    return proc;
  }

  async stopGateway(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (this.gateway) await this.gateway.kill(signal);
  }

  /** Requête d'une personne au central (routes humaines, jeton du faux serveur d'identité). */
  human(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    who: TestPerson = this.world.w.operatorAdminA,
    key: string | null = method === 'POST' ? randomUUID() : null,
  ): Promise<TerminalResponse> {
    return send(
      {
        url: new URL(`${this.centralBaseUrl}${path}`),
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(key !== null ? { 'idempotency-key': key } : {}),
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : '',
        cert: null,
        key: null,
      },
      this.serverCa,
    );
  }

  /** Bascule du débit vers la passerelle (`202`), puis attente de l'état `ACTIVE` local. */
  async switchToEdge(reason = 'Coupure réseau prévue'): Promise<TerminalResponse> {
    const res = await this.human('POST', `/ledgers/${this.ledgerId}/debit-authority`, {
      target: 'EDGE',
      reason,
      edge_gateway_id: this.gatewayId,
    });
    if (res.status !== 202) throw new Error(`bascule refusée : ${res.status} ${res.text}`);
    return res;
  }

  /** Demande de rendu au central (`target: CENTRAL`). */
  releaseToCentral(reason = 'Fin de coupure'): Promise<TerminalResponse> {
    return this.human('POST', `/ledgers/${this.ledgerId}/debit-authority`, {
      target: 'CENTRAL',
      reason,
    });
  }

  localAuthority(): Promise<Record<string, unknown> | undefined> {
    return this.localQuery('SELECT * FROM edge_authority').then((rows) => rows[0]);
  }

  /** Attend l'état d'autorité local voulu. */
  waitLocalState(state: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    return until(
      `autorité locale ${state}`,
      async () => {
        const row = await this.localAuthority();
        if (row?.state === state) this.epoch = Number(row.epoch ?? this.epoch);
        return row?.state === state ? row : null;
      },
      timeoutMs,
      100,
    );
  }

  // ---------------------------------------------------------------- terminaux sur la passerelle

  private readonly gwTokens = new Map<string, { token: string; at: number }>();
  /** Époque d'autorité locale connue (en-tête `X-Authority-Epoch` des paiements). */
  epoch = 0;

  /** Relève l'époque locale (à appeler après une bascule ou un rendu). */
  async refreshEpoch(): Promise<number> {
    const row = await this.localAuthority();
    this.epoch = Number(row?.epoch ?? 0);
    return this.epoch;
  }

  /**
   * Jeton d'accès de la PASSERELLE d'un terminal : `POST /device-tokens/refresh` (preuve de
   * possession du jeton de
   * rafraîchissement, famille répliquée depuis le central). Renouvelé au bout de 10 minutes (durée
   * de vie : 15).
   */
  async gatewayToken(term: PayTerminal): Promise<string> {
    const known = this.gwTokens.get(term.t.deviceId);
    if (known && Date.now() - known.at < 10 * 60_000) return known.token;
    const t = term.t;
    const nonce = randomBytes(18).toString('base64url');
    const signature = nodeSign('sha256', refreshProofMessage(nonce, t.serial, t.refreshToken), {
      key: t.signing.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    const res = await t.request(this.gwBaseUrl, this.serverCa, {
      method: 'POST',
      path: '/device-tokens/refresh',
      body: {
        serial: t.serial,
        refresh_token: t.refreshToken,
        nonce,
        signature: signature.toString('base64'),
      },
    });
    if (res.status !== 200)
      throw new Error(`jeton de passerelle refusé : ${res.status} ${res.text}`);
    const token = String(res.body.access_token);
    this.gwTokens.set(t.deviceId, { token, at: Date.now() });
    return token;
  }

  /** Requête signée d'un terminal À LA PASSERELLE (jeton de la passerelle, sans toucher à celui du
  /** central). */
  async gwRequest(
    term: PayTerminal,
    spec: TerminalRequest,
    headers: Record<string, string | null> = {},
  ): Promise<TerminalResponse> {
    const token = await this.gatewayToken(term);
    const saved = term.t.token;
    term.t.token = token;
    try {
      return await term.t.request(this.gwBaseUrl, this.serverCa, spec, { headers });
    } finally {
      term.t.token = saved;
    }
  }

  /** `POST /payments` sur la passerelle ; `epoch` : défaut l'époque locale connue. */
  gwPay(
    term: PayTerminal,
    body: unknown,
    o: { epoch?: number | null; key?: string } = {},
  ): Promise<TerminalResponse> {
    return this.gwRequest(
      term,
      {
        method: 'POST',
        path: '/payments',
        body,
        idempotencyKey: o.key ?? term.t.seqKey(),
      },
      o.epoch === null ? {} : { 'x-authority-epoch': String(o.epoch ?? this.epoch) },
    );
  }

  /**
   * Ordre local signé par les DEUX responsables du site (clés du banc), posté sur le port d'administration de la
   * passerelle (`POST /local/orders`, boucle locale ; en clair hors production). `signers` : indices des
   * responsables qui signent (défaut : les deux).
   */
  async localOrder(
    kind: string,
    options: { signers?: Array<0 | 1>; extra?: Record<string, string | number | boolean> } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const order: OrderPayload = {
      kind,
      gateway_id: this.gatewayId,
      issued_at: new Date().toISOString(),
      nonce: `bench-${randomBytes(12).toString('hex')}`,
      ...options.extra,
    };
    const signatures = (options.signers ?? [0, 1]).map((i) => {
      const key = this.siteKeys![i]!;
      return {
        holder: key.holder,
        signature: nodeSign('sha256', orderBytes(order), {
          key: KeyObject.from(key.privateKey),
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url'),
      };
    });
    const res = await fetch(`http://127.0.0.1:${this.adminPort}/local/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order, signatures }),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  }

  /** Lecture SQL de la base locale de la passerelle (propriétaire `edge_app`). */
  localQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.edgeDb.pool.query<T>(sql, params).then((r) => r.rows);
  }

  /** Lecture SQL de la base du central (propriétaire). */
  centralQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return withOwner(async (db: Client) => (await db.query<T>(sql, params)).rows);
  }

  async close(): Promise<void> {
    await this.gateway?.kill('SIGKILL').catch(() => undefined);
    await this.relay?.close().catch(() => undefined);
    await this.edge?.close().catch(() => undefined);
    await this.world?.close().catch(() => undefined);
    await this.edgeDb?.drop().catch(() => undefined);
    await this.centralDb?.drop().catch(() => undefined);
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }
}

export { mkdirSync };
