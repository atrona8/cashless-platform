// Banc des preuves de terminal (WP19) : vraie base locale jetable, vraie application Nest en HTTPS
// (TLS 1.3, certificat client DEMANDÉ puis jugé par la garde), vraie autorité des terminaux de test.
// Le terminal de test signe comme le contrat : certificat, jeton, signature RFC 9421.
import 'reflect-metadata';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as nodeSign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { writeFileSync } from 'node:fs';
import https from 'node:https';
import { SignJWT } from 'jose';
import { join } from 'node:path';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { serializeDictionary, type Item } from 'structured-headers';
import { AUTHORITY, AuthorityService } from '../../../src/authority/authority.service';
import type { CentralClient } from '../../../src/central-client/central-client';
import { EDGE_QUEUE, EdgeQueue } from '../../../src/queue/edge-queue';
import { StaffModule } from '../../../src/staff/staff.module';
import { CounterModule } from '../../../src/operations/counter/counter.module';
import {
  DEPOSIT_TERMS,
  type DepositTermsPort,
} from '../../../src/operations/counter/deposit-terms';
import { GATEWAY_CLOCK, type GatewayClock } from '../../../src/clock/gateway-clock';
import { GATEWAY_CONFIG, type GatewayConfig } from '../../../src/config/config';
import { GatewayTx } from '../../../src/db/gateway-tx';
import { GATEWAY_POOL } from '../../../src/db/pool';
import {
  DEVICE_PROOFS_OPTIONS,
  DeviceProofs,
  DeviceProofsGuard,
  requestDevice,
} from '../../../src/device-proofs/device-proofs.guard';
import { NonceStore } from '../../../src/device-proofs/nonce-store';
import { ProblemFilter } from '../../../src/device-proofs/problem';
import { ServedOperation } from '../../../src/processes/served-operations';
import {
  contentDigest,
  signatureBase,
  signatureParamsList,
  READ_COMPONENTS,
  WRITE_COMPONENTS,
} from '../../../src/device-proofs/request-signature';
import { DeviceTokenService } from '../../../src/device/device-token.service';
import { DeviceModule } from '../../../src/device/device.module';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import {
  HARDWARE_KEYSTORE,
  type HardwareKeystore,
} from '../../../src/key-store/hardware-keystore.port';
import { ServedOperationGuard } from '../../../src/processes/served-operations';
import { tlsServerOptions } from '../../../src/processes/bootstrap';
import { createTestDb, type TestDb } from '../../startup/_support/db';
import { enrolledFixture, tempDir } from '../../startup/_support/fixture';
import { makeRealCa, type RealCa } from '../../device/_support/pki';

export const ISSUER = 'https://id.test/realm';
export const AUDIENCE = 'cashless-edge-test';

export class TestClock implements GatewayClock {
  offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  async observeCentral(): Promise<void> {}
  skewAlert(): boolean {
    return false;
  }
  refusesAck(): boolean {
    return false;
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

/** Port matériel dont la clé `token` peut être remplacée (rotation côté matériel). */
export class RotatableKeystore implements HardwareKeystore {
  inner = new FakeHardwareKeystore();
  readonly isFake = true;
  rotate(): void {
    this.inner = new FakeHardwareKeystore();
  }
  sign: HardwareKeystore['sign'] = (use, data) => this.inner.sign(use, data);
  agree: HardwareKeystore['agree'] = (peer) => this.inner.agree(peer);
  publicKey: HardwareKeystore['publicKey'] = (use) => this.inner.publicKey(use);
  destroy: HardwareKeystore['destroy'] = (use) => this.inner.destroy(use);
}

export interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: Record<string, unknown> | null;
  elapsedMs: number;
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  rawBody?: string;
  /** Jeton d'accès (défaut : un jeton valide de la passerelle). `null` : pas d'en-tête. */
  token?: string | null;
  /** Remplace la signature (en-têtes `Signature-Input` et `Signature`). */
  noSignature?: boolean;
  signer?: KeyObject;
  authority?: string;
  hostHeader?: string;
  idempotencyKey?: string;
  created?: number;
  nonce?: string;
  /** Certificat client présenté (défaut : celui du terminal). `null` : aucun. */
  cert?: { certPem: string; keyPem: string } | null;
  headers?: Record<string, string>;
  requestId?: string;
  query?: string;
}

export interface TestDevice {
  deviceId: string;
  serial: string;
  fid: string;
  refreshToken: string;
  signing: { publicKey: KeyObject; privateKey: KeyObject; spki: Buffer };
  cert: { certPem: string; keyPem: string; sha256: Buffer };
}

export interface Bench {
  db: TestDb;
  app: INestApplication;
  port: number;
  authority: string;
  clock: TestClock;
  keystore: RotatableKeystore;
  config: GatewayConfig;
  tokens: DeviceTokenService;
  deviceCa: RealCa;
  gatewayId: string;
  ids: { event: string; ledger: string; operator: string };
  terms: { current: DepositTermsPort };
  identity: { kid: string; privateKey: KeyObject };
  newDevice(
    options?: Partial<{
      status: string;
      os: string | null;
      revokeFamily: boolean;
      appMode: string;
    }>,
  ): Promise<TestDevice>;
  tokenFor(device: TestDevice): Promise<string>;
  request(device: TestDevice, options: RequestOptions): Promise<Response>;
  /** Requête sans terminal (corps libre), certificat facultatif. */
  raw(options: RequestOptions & { device?: TestDevice }): Promise<Response>;
  q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const b64u = (b: Buffer): string => b.toString('base64url');

export function newKeyPair(): TestDevice['signing'] {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { publicKey, privateKey, spki: publicKey.export({ type: 'spki', format: 'der' }) };
}

async function issueCert(ca: RealCa, subject: string): Promise<TestDevice['cert']> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const certPem = await ca.sign(subject, publicKey.export({ type: 'spki', format: 'der' }));
  return {
    certPem,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    sha256: createHash('sha256').update(new X509Certificate(certPem).raw).digest(),
  };
}

export async function makeBench(
  options: { failureFloorMs?: number; terms?: DepositTermsPort } = {},
): Promise<Bench> {
  const db = await createTestDb();
  const deviceCa = await makeRealCa('CN=device-ca-test');
  const keystore = new RotatableKeystore();
  const fx = await enrolledFixture(db, { device_ca_pem: deviceCa.certPem });
  // L'enrôlement a créé ses clés dans un autre faux : on pose celui du banc.
  const dir = tempDir();
  const serverCa = await makeRealCa('CN=server-ca-test');
  const server = await issueCert(serverCa, 'CN=localhost');
  writeFileSync(join(dir, 'server.crt'), server.certPem);
  writeFileSync(join(dir, 'server.key'), server.keyPem);
  writeFileSync(join(dir, 'device-ca.pem'), deviceCa.certPem);
  const config = {
    nodeEnv: 'test',
    production: false,
    databaseUrl: db.url,
    centralUrl: null,
    listenPort: 0,
    tlsCertFile: join(dir, 'server.crt'),
    tlsKeyFile: join(dir, 'server.key'),
    deviceCaFile: join(dir, 'device-ca.pem'),
    centralClientCertFile: null,
    centralClientKeyFile: null,
    requestAuthority: 'pending',
    enrollmentFile: null,
    hardwareKeystore: 'fake',
    failpoint: null,
    allowFailpoints: null,
    identityJwksUrl: null,
    identityVerifier: null,
    identityIssuer: ISSUER,
    identityAudience: AUDIENCE,
    adminPort: 0,
    edgeCa: null,
    devKeyFile: null,
  } as GatewayConfig;
  const clock = new TestClock();
  const gatewayTx = new GatewayTx(db.pool);
  const authorityService = new AuthorityService(gatewayTx, clock, {} as CentralClient);
  const terms: { current: DepositTermsPort } = {
    current: options.terms ?? { lookup: async () => null },
  };
  const termsPort: DepositTermsPort = { lookup: (tx, media) => terms.current.lookup(tx, media) };
  const identityPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const identity = { kid: 'id-key-1', privateKey: identityPair.privateKey };

  @Global()
  @Module({
    imports: [DeviceModule, StaffModule, CounterModule],
    providers: [
      { provide: GATEWAY_CONFIG, useValue: config },
      { provide: GATEWAY_POOL, useValue: db.pool },
      GatewayTx,
      { provide: GATEWAY_CLOCK, useValue: clock },
      { provide: HARDWARE_KEYSTORE, useValue: keystore },
      { provide: AUTHORITY, useValue: authorityService },
      EdgeQueue,
      { provide: EDGE_QUEUE, useExisting: EdgeQueue },
      { provide: DEPOSIT_TERMS, useValue: termsPort },
      { provide: APP_GUARD, useClass: ServedOperationGuard },
      {
        provide: DEVICE_PROOFS_OPTIONS,
        useValue: { failureFloorMs: options.failureFloorMs ?? 60 },
      },
    ],
    exports: [
      GATEWAY_CONFIG,
      GATEWAY_POOL,
      GatewayTx,
      GATEWAY_CLOCK,
      HARDWARE_KEYSTORE,
      AUTHORITY,
      DEVICE_PROOFS_OPTIONS,
      EDGE_QUEUE,
      EdgeQueue,
      DEPOSIT_TERMS,
    ],
  })
  class BenchModule {}

  const moduleRef = await Test.createTestingModule({ imports: [BenchModule] }).compile();
  const httpsOptions = tlsServerOptions(config)!;
  const app = moduleRef.createNestApplication({ httpsOptions, rawBody: true, logger: false });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  const authority = `127.0.0.1:${port}`;
  config.requestAuthority = authority;
  void fx;

  const meta = (
    await db.pool.query('SELECT gateway_id, event_id, ledger_id, operator_id FROM edge_meta')
  ).rows[0] as { gateway_id: string; event_id: string; ledger_id: string; operator_id: string };
  await db.pool.query(
    `INSERT INTO edge_event_setting (id, status, currency, minor_units, timezone, activation_modes,
        terminal_settings, name, wallet_limits, offline_policy)
     VALUES (true, 'LIVE', 'XOF', 0, 'Africa/Dakar', '{DESK}', $1, 'Festival test', $2, '{}')`,
    [
      JSON.stringify({
        online_connect_timeout_ms: 2000,
        online_total_timeout_ms: 3000,
        online_retries: 2,
        pending_sync_seconds: 30,
        reconcile_sync_seconds: 300,
        heartbeat_seconds: 60,
        reversal_window_minutes: 15,
        local_retention_days: 7,
        tap_replay_window_seconds: 120,
      }),
      JSON.stringify({
        max_wallet_balance: 2_000_000,
        unidentified_max_balance: 1_000_000,
        identified_monthly_limit: 5_000_000,
        unidentified_monthly_limit: 3_000_000,
      }),
    ],
  );

  const tokens = moduleRef.get(DeviceTokenService);
  const gw = new GatewayTx(db.pool);

  const bench: Bench = {
    db,
    app,
    port,
    authority,
    clock,
    keystore,
    config,
    tokens,
    deviceCa,
    gatewayId: meta.gateway_id,
    ids: { event: meta.event_id, ledger: meta.ledger_id, operator: meta.operator_id },
    terms,
    identity,

    async newDevice(opts = {}) {
      const deviceId = randomUUID();
      const serial = `TERM-${deviceId.slice(0, 8)}`;
      const signing = newKeyPair();
      const cert = await issueCert(deviceCa, `CN=${serial}`);
      const refreshToken = `drt_${randomBytes(32).toString('base64url')}`;
      const fid = randomUUID();
      await db.pool.query(
        `INSERT INTO edge_device (device_id, serial, kind, app_mode, status, public_key, cert_sha256,
           os, nfc_enabled, station_name, pos_id, pos_name, merchant_name)
         VALUES ($1, $2, 'POS', $8, $3, $4, $5, $6, true, 'Bar 1', $7, 'Bar central', 'Marchand SA')`,
        [
          deviceId,
          serial,
          opts.status ?? 'ACTIVE',
          signing.spki,
          cert.sha256,
          opts.os === undefined ? 'ANDROID' : opts.os,
          randomUUID(),
          opts.appMode ?? 'TOPUP_DESK',
        ],
      );
      await db.pool.query(
        `INSERT INTO edge_device_token_family (fid, device_id, status, refresh_token_sha256_current)
         VALUES ($1, $2, $3, $4)`,
        [
          fid,
          deviceId,
          opts.revokeFamily ? 'REVOKED' : 'ACTIVE',
          createHash('sha256').update(refreshToken).digest(),
        ],
      );
      await db.pool.query(
        `UPDATE edge_event_setting SET offline_policy = offline_policy || $1::jsonb`,
        [
          JSON.stringify({
            [deviceId]: {
              config_id: 7,
              offline_enabled: true,
              max_per_sale: 5000,
              max_per_media_per_device: 20000,
              max_total_per_device: 100000,
              max_snapshot_age_seconds: 900,
              cash_topup_offline: false,
              capped: false,
            },
          }),
        ],
      );
      return { deviceId, serial, fid, refreshToken, signing, cert };
    },

    async tokenFor(device) {
      const issued = await gw.run((tx) =>
        tokens.issue(tx, {
          deviceId: device.deviceId,
          serial: device.serial,
          familyId: device.fid,
          signingSpki: device.signing.spki,
        }),
      );
      return issued.token;
    },

    async raw(opts) {
      const method = opts.method ?? 'GET';
      const bodyText = opts.rawBody ?? (opts.body === undefined ? '' : JSON.stringify(opts.body));
      const body = Buffer.from(bodyText, 'utf8');
      const requestId = opts.requestId ?? randomUUID();
      const authority = opts.authority ?? opts.hostHeader ?? bench.authority;
      const headers: Record<string, string> = {
        host: opts.hostHeader ?? authority,
        'x-request-id': requestId,
        'content-digest': contentDigest(body),
        ...(opts.body !== undefined || opts.rawBody !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        ...opts.headers,
      };
      if (opts.device && !opts.noSignature) {
        const parts = {
          method,
          authority: (opts.authority ?? bench.authority).toLowerCase(),
          path: opts.path,
          query: opts.query ?? '',
          contentDigest: headers['content-digest']!,
          requestId,
          idempotencyKey: opts.idempotencyKey ?? null,
        };
        const list = signatureParamsList(
          parts.idempotencyKey === null ? READ_COMPONENTS : WRITE_COMPONENTS,
          {
            created: opts.created ?? Math.floor(bench.clock.now().getTime() / 1000),
            nonce: opts.nonce ?? b64u(randomBytes(16)),
            keyid: opts.device.deviceId,
          },
        );
        const signature = nodeSign('sha256', Buffer.from(signatureBase(parts, list), 'utf8'), {
          key: opts.signer ?? opts.device.signing.privateKey,
          dsaEncoding: 'ieee-p1363',
        });
        headers['signature-input'] = serializeDictionary(new Map([['dev', list]]));
        headers.signature = serializeDictionary(new Map([['dev', [signature, new Map()] as Item]]));
      }
      if (opts.token !== null && opts.token !== undefined) {
        headers.authorization = `Bearer ${opts.token}`;
      }
      const cert = opts.cert === undefined ? opts.device?.cert : opts.cert;
      const started = process.hrtime.bigint();
      return new Promise<Response>((resolve, reject) => {
        const req = https.request(
          {
            host: '127.0.0.1',
            port: bench.port,
            method,
            path: opts.path + (opts.query ? `?${opts.query}` : ''),
            headers: { ...headers, 'content-length': String(body.length) },
            rejectUnauthorized: false,
            minVersion: 'TLSv1.3',
            ...(cert ? { cert: cert.certPem, key: cert.keyPem } : {}),
            agent: false,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let json: Record<string, unknown> | null = null;
              try {
                json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
              } catch {
                json = null;
              }
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                text,
                json,
                elapsedMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
              });
            });
          },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    },

    async request(device, opts) {
      const token = opts.token === undefined ? await bench.tokenFor(device) : opts.token;
      return bench.raw({ ...opts, device, token });
    },

    async q(sql, params = []) {
      return (await db.pool.query(sql, params)).rows;
    },

    async close() {
      await app.close();
      await db.drop();
    },
  };
  return bench;
}

// ---- aides propres aux tests de guichet --------------------------------------------------------

export interface TokenOptions {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  /** Secondes depuis l'époque ; défaut : dans une heure. */
  exp?: number;
  iat?: number | null;
  jti?: string | null;
  kid?: string;
  key?: KeyObject;
  alg?: string;
}

/** Jeton de personne signé par la clé d'identité du banc (ES256). */
export async function staffToken(bench: Bench, o: TokenOptions = {}): Promise<string> {
  const nowS = Math.floor(bench.clock.now().getTime() / 1000);
  const claims: Record<string, unknown> = { sub: o.sub ?? 'cashier-1' };
  if (o.jti !== null) claims.jti = o.jti ?? randomUUID();
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: o.alg ?? 'ES256', kid: o.kid ?? bench.identity.kid })
    .setIssuer(o.iss ?? ISSUER)
    .setAudience(o.aud ?? AUDIENCE)
    .setExpirationTime(o.exp ?? nowS + 3600);
  if (o.iat !== null) jwt.setIssuedAt(o.iat ?? nowS - 60);
  return jwt.sign(o.key ?? bench.identity.privateKey);
}

/** Pose la clé publique d'identité du banc dans `edge_identity_key`. */
export async function seedIdentityKey(bench: Bench): Promise<void> {
  const publicKey = createPublicKey(bench.identity.privateKey);
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: bench.identity.kid, alg: 'ES256' };
  await bench.q(
    `INSERT INTO edge_identity_key (kid, jwk, issuer) VALUES ($1, $2, $3)
     ON CONFLICT (kid) DO NOTHING`,
    [bench.identity.kid, JSON.stringify(jwk), ISSUER],
  );
}

export async function seedStaff(
  bench: Bench,
  sub = 'cashier-1',
  o: { status?: string; roles?: string[] } = {},
): Promise<void> {
  await bench.q(
    `INSERT INTO edge_staff (iss, sub, status, roles) VALUES ($1, $2, $3, $4)
     ON CONFLICT (iss, sub) DO UPDATE SET status = EXCLUDED.status, roles = EXCLUDED.roles`,
    [ISSUER, sub, o.status ?? 'ACTIVE', o.roles ?? ['CASHIER']],
  );
}

/** Autorité `ACTIVE` à l'époque 3, accusée à `activatedAt` (heure centrale), tolérance 12 h fixe. */
export async function activateAuthority(bench: Bench, activatedAt: Date, epoch = 3): Promise<void> {
  await bench.q(`UPDATE edge_authority SET state = 'GRANTED_PENDING'
                  WHERE state IN ('ARMED', 'STALE')`);
  await bench.q(
    `UPDATE edge_authority SET state = 'ACTIVE', epoch = $1, highest_epoch_seen = $1,
            activated_at = $2, token_tolerance_until = $3`,
    [epoch, activatedAt, new Date(activatedAt.getTime() + 12 * 3_600_000)],
  );
}

export interface SeedSession {
  id: string;
  accountId: string;
}

/** Session de caisse ; `usable_on_edge` se déduit de l'ouverture avant `activated_at`. */
export async function seedSession(
  bench: Bench,
  device: TestDevice,
  o: {
    openedBy?: string;
    openedAt: Date;
    status?: string;
    usable?: boolean;
    closedAt?: Date | null;
  },
): Promise<SeedSession> {
  const id = randomUUID();
  const accountId = randomUUID();
  await bench.q(
    `INSERT INTO edge_cash_session (cash_session_id, device_id, cash_account_id, opened_by_iss,
        opened_by_sub, opened_at, status, usable_on_edge, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      device.deviceId,
      accountId,
      ISSUER,
      o.openedBy ?? 'cashier-1',
      o.openedAt,
      o.status ?? 'OPEN',
      o.usable ?? true,
      o.closedAt ?? null,
    ],
  );
  return { id, accountId };
}

export interface SeedMedia {
  mediaId: string;
  walletId: string | null;
  tokenHashHex: string;
  uidHex: string;
}

export async function seedMedia(
  bench: Bench,
  o: {
    wallet?: boolean;
    status?: string;
    batchStatus?: string | null;
    paid?: number;
    kyc?: boolean;
    monthPaid?: number;
    signature?: string;
    counter?: number;
  } = {},
): Promise<SeedMedia> {
  const mediaId = randomUUID();
  const walletId = o.wallet === false ? null : randomUUID();
  const tokenHash = randomBytes(32);
  const uid = randomBytes(7);
  await bench.q(
    `INSERT INTO edge_media (token_hash, media_id, wallet_id, status, batch_id, batch_status, uid,
        counter_last, originality_sig_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tokenHash,
      mediaId,
      walletId,
      o.status ?? (walletId ? 'ACTIVE' : 'ISSUED'),
      randomUUID(),
      o.batchStatus === undefined ? 'ACTIVE' : o.batchStatus,
      uid,
      o.counter ?? 0,
      o.signature ? createHash('sha256').update(Buffer.from(o.signature, 'hex')).digest() : null,
    ],
  );
  if (walletId) {
    await bench.q(
      `INSERT INTO edge_wallet (wallet_id, status, central_paid, central_promo, applied_edge_seq)
       VALUES ($1, 'ACTIVE', $2, 0, 0)`,
      [walletId, o.paid ?? 0],
    );
    await bench.q(
      `INSERT INTO edge_wallet_limit (wallet_id, topup_month_paid, limits) VALUES ($1, $2, $3)`,
      [
        walletId,
        o.monthPaid ?? 0,
        JSON.stringify({ topup_month_known: true, kyc_verified: o.kyc ?? false }),
      ],
    );
  }
  return {
    mediaId,
    walletId,
    tokenHashHex: tokenHash.toString('hex'),
    uidHex: uid.toString('hex'),
  };
}

export function tapOf(media: SeedMedia, bench: Bench, o: { counter?: number; sig?: string } = {}) {
  return {
    nfc_uid: media.uidHex,
    token_hash: media.tokenHashHex,
    counter: o.counter ?? 5,
    key_index: 1,
    pack_verified: true,
    ...(o.sig ? { originality_signature: o.sig } : {}),
    occurred_at: bench.clock.now().toISOString(),
  };
}

/** Requête de guichet : trois preuves + jeton de personne + clé d'idempotence. */
export async function counterRequest(
  bench: Bench,
  device: TestDevice,
  o: {
    path: string;
    body?: unknown;
    key: string;
    staff?: string | null;
    epoch?: number;
    headers?: Record<string, string>;
    nonce?: string;
  },
): Promise<Response> {
  const staff = o.staff === undefined ? await staffToken(bench) : o.staff;
  return bench.request(device, {
    method: 'POST',
    path: o.path,
    body: o.body ?? {},
    idempotencyKey: o.key,
    nonce: o.nonce,
    headers: {
      ...(staff !== null ? { 'x-staff-authorization': `Bearer ${staff}` } : {}),
      ...(o.epoch !== undefined ? { 'x-authority-epoch': String(o.epoch) } : {}),
      ...o.headers,
    },
  });
}

export const opCount = async (bench: Bench): Promise<number> =>
  Number((await bench.q<{ n: string }>('SELECT count(*) AS n FROM edge_op'))[0]!.n);

/** Banc prêt : clé d'identité, personne, autorité active, un terminal et sa session. */
export async function readyBench(
  o: {
    activatedAgoMs?: number;
    sessionOpenedAgoMs?: number;
    terms?: DepositTermsPort;
    appMode?: string;
  } = {},
): Promise<{ bench: Bench; device: TestDevice; session: SeedSession; activatedAt: Date }> {
  const bench = await makeBench({ failureFloorMs: 5, terms: o.terms });
  await seedIdentityKey(bench);
  await seedStaff(bench);
  const device = await bench.newDevice({ appMode: o.appMode });
  const activatedAt = new Date(bench.clock.now().getTime() - (o.activatedAgoMs ?? 60_000));
  const session = await seedSession(bench, device, {
    openedAt: new Date(activatedAt.getTime() - (o.sessionOpenedAgoMs ?? 3_600_000)),
  });
  await activateAuthority(bench, activatedAt);
  return { bench, device, session, activatedAt };
}

let sequence = 1000;
/** Recharge de 1 000 XOF sur `media` avec un jeton de personne donné (défaut : jeton valide). */
export async function postTopup(
  bench: Bench,
  device: TestDevice,
  media: SeedMedia,
  o: {
    staff?: string | null;
    amount?: number;
    body?: Record<string, unknown>;
    key?: string;
    epoch?: number;
  } = {},
): Promise<Response> {
  sequence += 1;
  return counterRequest(bench, device, {
    path: '/v1/topups/cash',
    key: o.key ?? `${device.serial}:${sequence}`,
    epoch: o.epoch ?? 3,
    staff: o.staff,
    body: {
      amount: o.amount ?? 1000,
      currency: 'XOF',
      occurred_at: bench.clock.now().toISOString(),
      tap: tapOf(media, bench),
      ...o.body,
    },
  });
}

export const epochSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

/** Jeton expiré mais toléré : émis une demi-heure avant la bascule, expire une demi-heure après. */
export function toleratedToken(
  bench: Bench,
  activatedAt: Date,
  o: TokenOptions = {},
): Promise<string> {
  const base = epochSeconds(activatedAt);
  return staffToken(bench, { iat: base - 1800, exp: base + 1800, ...o });
}
