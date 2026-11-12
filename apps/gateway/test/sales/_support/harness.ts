// Banc des ventes (WP21) : copie PROPRE du banc de WP19 (`test/device/_support/harness.ts`), avec la
// vraie autorité (`AuthorityService` sur la vraie base locale), la vraie file (`EdgeQueue`), les
// vraies routes de vente en HTTPS (TLS 1.3, certificat client, jeton, signature RFC 9421).
// Seul le service de réplication est remplacé par sa lecture du solde effectif (WP18).
import 'reflect-metadata';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as nodeSign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { writeFileSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { serializeDictionary, type Item } from 'structured-headers';
import { AUTHORITY, AuthorityService } from '../../../src/authority/authority.service';
import type { CentralClient } from '../../../src/central-client/central-client';
import { GATEWAY_CLOCK, type GatewayClock } from '../../../src/clock/gateway-clock';
import { GATEWAY_CONFIG, type GatewayConfig } from '../../../src/config/config';
import { GatewayTx } from '../../../src/db/gateway-tx';
import { GATEWAY_POOL } from '../../../src/db/pool';
import { DEVICE_PROOFS_OPTIONS } from '../../../src/device-proofs/device-proofs.guard';
import {
  contentDigest,
  signatureBase,
  signatureParamsList,
  READ_COMPONENTS,
  WRITE_COMPONENTS,
} from '../../../src/device-proofs/request-signature';
import { DeviceTokenService } from '../../../src/device/device-token.service';
import { EDGE_QUEUE, EdgeQueue } from '../../../src/queue/edge-queue';
import { readEffectiveBalance } from '../../../src/replication/effective-balance';
import { ReplicationService } from '../../../src/replication/replication.service';
import { SalesModule } from '../../../src/operations/sales/sales.module';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import {
  HARDWARE_KEYSTORE,
  type HardwareKeystore,
} from '../../../src/key-store/hardware-keystore.port';
import { ServedOperationGuard } from '../../../src/processes/served-operations';
import { tlsServerOptions } from '../../../src/processes/bootstrap';
import { createTestDb, type TestDb } from '../../startup/_support/db';
import { enrolledFixture, tempDir } from '../../startup/_support/fixture';
import { makeRealCa, type RealCa } from './pki';

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
  /** Connexion persistante (mesure de latence : pas de poignée de main TLS à chaque requête). */
  agent?: https.Agent;
}

export interface TestDevice {
  deviceId: string;
  serial: string;
  fid: string;
  refreshToken: string;
  signing: { publicKey: KeyObject; privateKey: KeyObject; spki: Buffer };
  cert: { certPem: string; keyPem: string; sha256: Buffer };
}

export interface BraceletOptions {
  paid: number;
  promo: number;
  counterLast: number;
  status: string;
  walletStatus: string;
  batchStatus: string | null;
  withSignature: boolean;
}

export interface Bracelet {
  tokenHash: string;
  uid: string;
  signature: string;
  walletId: string;
  mediaId: string;
  /** Corps `TapInput` d'un passage de ce bracelet au compteur donné. */
  tap(counter: number, extra?: Record<string, unknown>): Record<string, unknown>;
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
  authoritySvc: AuthorityService;
  /** Pose l'état d'autorité directement (déclencheur de transitions suspendu le temps de l'écriture). */
  setAuthority(patch: Record<string, string | number | boolean | Date | null>): Promise<void>;
  /** Un bracelet répliqué, activé, avec ce solde. */
  newBracelet(options?: Partial<BraceletOptions>): Promise<Bracelet>;
  /** Une session de vendeur ouverte sur ce terminal. */
  newVendorSession(
    device: TestDevice,
    options?: Partial<{ blocked: boolean; expiresInMs: number; closed: boolean }>,
  ): Promise<{ vendorId: string; sessionId: string }>;
  /** Un article au catalogue du point de vente du terminal. */
  newProduct(device: TestDevice, price: number): Promise<string>;
  newDevice(
    options?: Partial<{ status: string; os: string | null; revokeFamily: boolean }>,
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

export async function makeBench(options: { failureFloorMs?: number } = {}): Promise<Bench> {
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
    adminPort: 0,
    edgeCa: null,
    devKeyFile: null,
  } as GatewayConfig;
  const clock = new TestClock();

  @Global()
  @Module({
    imports: [SalesModule],
    providers: [
      { provide: GATEWAY_CONFIG, useValue: config },
      { provide: GATEWAY_POOL, useValue: db.pool },
      GatewayTx,
      { provide: GATEWAY_CLOCK, useValue: clock },
      { provide: HARDWARE_KEYSTORE, useValue: keystore },
      {
        provide: AUTHORITY,
        useFactory: (tx: GatewayTx, c: GatewayClock) =>
          new AuthorityService(tx, c, {} as CentralClient),
        inject: [GatewayTx, GATEWAY_CLOCK],
      },
      EdgeQueue,
      { provide: EDGE_QUEUE, useExisting: EdgeQueue },
      {
        provide: ReplicationService,
        useValue: { effectiveBalance: readEffectiveBalance },
      },
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
      EDGE_QUEUE,
      EdgeQueue,
      ReplicationService,
      DEVICE_PROOFS_OPTIONS,
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
        terminal_settings, name, wallet_limits, offline_policy, edge_terms)
     VALUES (true, 'LIVE', 'XOF', 0, 'Africa/Dakar', '{DESK}', $1, 'Festival test', '{}', '{}',
             '{"spend_order": "PROMO_FIRST"}')`,
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
    authoritySvc: moduleRef.get(AUTHORITY),

    async setAuthority(patch) {
      const client = await db.pool.connect();
      try {
        await client.query('ALTER TABLE edge_authority DISABLE TRIGGER edge_authority_guard');
        const names = Object.keys(patch);
        await client.query(
          `UPDATE edge_authority SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}`,
          names.map((n) => patch[n]),
        );
      } finally {
        await client.query('ALTER TABLE edge_authority ENABLE TRIGGER edge_authority_guard');
        client.release();
      }
    },

    async newBracelet(o = {}) {
      const opts = {
        paid: 10_000,
        promo: 0,
        counterLast: 0,
        status: 'ACTIVE',
        walletStatus: 'ACTIVE',
        batchStatus: 'ACTIVE' as string | null,
        withSignature: true,
        ...o,
      };
      const uid = randomBytes(7).toString('hex');
      const tokenHash = randomBytes(32).toString('hex');
      const signature = randomBytes(32).toString('hex');
      const walletId = randomUUID();
      const mediaId = randomUUID();
      await db.pool.query(
        `INSERT INTO edge_wallet (wallet_id, status, central_paid, central_promo, applied_edge_seq)
         VALUES ($1, $2, $3, $4, 0)`,
        [walletId, opts.walletStatus, opts.paid, opts.promo],
      );
      await db.pool.query(
        `INSERT INTO edge_media (token_hash, media_id, wallet_id, status, batch_status, uid, counter_last,
                                 originality_sig_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          Buffer.from(tokenHash, 'hex'),
          mediaId,
          walletId,
          opts.status,
          opts.batchStatus,
          Buffer.from(uid, 'hex'),
          opts.counterLast,
          opts.withSignature
            ? createHash('sha256').update(Buffer.from(signature, 'hex')).digest()
            : null,
        ],
      );
      return {
        tokenHash,
        uid,
        signature,
        walletId,
        mediaId,
        tap: (counter, extra = {}) => ({
          nfc_uid: uid,
          token_hash: tokenHash,
          counter,
          key_index: 1,
          pack_verified: true,
          ...(opts.withSignature ? { originality_signature: signature } : {}),
          occurred_at: bench.clock.now().toISOString(),
          ...extra,
        }),
      };
    },

    async newVendorSession(device, o = {}) {
      const vendorId = randomUUID();
      const sessionId = randomUUID();
      await db.pool.query(
        `INSERT INTO edge_vendor (vendor_id, display_name, status, blocked) VALUES ($1, 'Awa', 'ACTIVE', $2)`,
        [vendorId, o.blocked === true],
      );
      await db.pool.query(
        `INSERT INTO edge_vendor_session (vendor_session_id, vendor_id, device_id, expires_at, closed_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          sessionId,
          vendorId,
          device.deviceId,
          new Date(Date.now() + (o.expiresInMs ?? 3_600_000)),
          o.closed === true ? new Date() : null,
        ],
      );
      return { vendorId, sessionId };
    },

    async newProduct(device, price) {
      const productId = randomUUID();
      const pos = (
        await db.pool.query('SELECT pos_id FROM edge_device WHERE device_id = $1', [
          device.deviceId,
        ])
      ).rows[0] as { pos_id: string };
      await db.pool.query(
        `INSERT INTO edge_catalog_item (pos_id, item_id, version, price, lines)
         VALUES ($1, $2, 4, $3, $4)`,
        [
          pos.pos_id,
          productId,
          price,
          JSON.stringify({ name_fr: 'Bière', name_en: 'Beer', vat_rate_bps: 1800 }),
        ],
      );
      return productId;
    },

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
         VALUES ($1, $2, 'POS', 'CATALOG_POS', $3, $4, $5, $6, true, 'Bar 1', $7, 'Bar central', 'Marchand SA')`,
        [
          deviceId,
          serial,
          opts.status ?? 'ACTIVE',
          signing.spki,
          cert.sha256,
          opts.os === undefined ? 'ANDROID' : opts.os,
          randomUUID(),
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
            agent: opts.agent ?? false,
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
  await bench.setAuthority({
    state: 'ACTIVE',
    link_state: 'CONNECTED',
    epoch: 3,
    highest_epoch_seen: 3,
    activated_at: new Date(),
  });
  return bench;
}
