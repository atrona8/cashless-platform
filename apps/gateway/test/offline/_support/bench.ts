// Banc des lots hors ligne et des snapshots (WP23) : vraie base locale jetable, vraie application Nest en HTTPS
// (certificat client, jeton, signature de requête), VRAI `AuthorityService` (états posés dans `edge_authority`
// par les transitions légales), vraie file `EdgeQueue`, vrai port matériel de développement. Aucun faux
// n'est servi en production : ce banc vit sous `test/`.
import 'reflect-metadata';
import {
  createECDH,
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
import { join } from 'node:path';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import canonicalize from 'canonicalize';
import { serializeDictionary, type Item } from 'structured-headers';
import { chainStep, chainedContent, contentSha256, edgeChainGenesis } from '@cashless/shared-rules';
import { pwdPackAad, sealForRecipient, sealPwdPack, toWrappedKey } from '@cashless/tag-format';
import { AUTHORITY, AuthorityService } from '../../../src/authority/authority.service';
import { GATEWAY_CLOCK } from '../../../src/clock/gateway-clock';
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
import { DeviceModule } from '../../../src/device/device.module';
import { HARDWARE_KEYSTORE } from '../../../src/key-store/hardware-keystore.port';
import {
  MEDIA_AUTH_OPTIONS,
  type MediaAuthOptions,
} from '../../../src/operations/offline/media-auth-key.service';
import { OfflineModule } from '../../../src/operations/offline/offline.module';
import { sealedKeyAad } from '../../../src/operations/offline/pack-crypto';
import { tlsServerOptions } from '../../../src/processes/bootstrap';
import { ServedOperationGuard } from '../../../src/processes/served-operations';
import { EDGE_QUEUE, EdgeQueue } from '../../../src/queue/edge-queue';
import { SnapshotWorker } from '../../../src/snapshots/snapshot-worker';
import { SnapshotsModule } from '../../../src/snapshots/snapshots.module';
import { newKeyPair, RotatableKeystore, TestClock } from '../../device/_support/harness';
import type { Response, TestDevice } from '../../device/_support/harness';
import { makeRealCa } from '../../device/_support/pki';
import { admin, createTestDb, type TestDb } from '../../startup/_support/db';
import { enrolledFixture, tempDir } from '../../startup/_support/fixture';
import type { Loose } from '../../support/loose';

export type { Response };

const b64u = (b: Buffer): string => b.toString('base64url');

export interface OfflineDevice extends TestDevice {
  agreement: { privateScalar: Buffer; publicPoint: Buffer };
  vendorSessionId: string;
}

export interface Bench {
  db: TestDb;
  app: INestApplication;
  port: number;
  authority: string;
  clock: TestClock;
  keystore: RotatableKeystore;
  worker: SnapshotWorker;
  gatewayId: string;
  ids: { event: string; ledger: string; operator: string };
  contentKey: Buffer;
  newDevice(options?: { policy?: Record<string, unknown> }): Promise<OfflineDevice>;
  setAuthority(state: string, epoch?: number): Promise<void>;
  seedMedia(input: SeedMedia): Promise<SeedMediaResult>;
  setPackKey(): Promise<void>;
  request(
    device: OfflineDevice,
    options: {
      method?: string;
      path: string;
      body?: unknown;
      idempotencyKey?: string;
      headers?: Record<string, string>;
      query?: string;
      nonce?: string;
      signer?: KeyObject;
    },
  ): Promise<Response>;
  q<T = Record<string, Loose>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface SeedMedia {
  balancePaid?: number;
  balancePromo?: number;
  status?: string;
  batchStatus?: string | null;
  walletStatus?: string;
  pwdPack?: Buffer;
  keyIndex?: number;
  uid?: Buffer;
  counterLast?: number;
}

export interface SeedMediaResult {
  tokenHash: Buffer;
  tokenHex: string;
  uid: Buffer;
  mediaId: string;
  walletId: string;
}

export async function makeBench(
  options: {
    media?: Partial<MediaAuthOptions>;
    snapshotIntervalMs?: number;
    /** `log_statement = all` sur la base du banc (canari NFR-010). */
    logAllStatements?: boolean;
  } = {},
): Promise<Bench> {
  const db = await createTestDb();
  if (options.logAllStatements) {
    await admin(async (c) => {
      await c.query(`ALTER DATABASE ${db.name} SET log_statement = 'all'`);
      // Les connexions déjà ouvertes (migrations) sont fermées : le pool rouvre des sessions journalisées.
      await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
        db.name,
      ]);
    });
  }
  const deviceCa = await makeRealCa('CN=device-ca-test');
  const serverCa = await makeRealCa('CN=server-ca-test');
  const keystore = new RotatableKeystore();
  const fx = await enrolledFixture(db, { device_ca_pem: deviceCa.certPem });
  void fx;
  const dir = tempDir();
  const { publicKey: serverPub, privateKey: serverPriv } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const serverCert = await serverCa.sign(
    'CN=localhost',
    serverPub.export({ type: 'spki', format: 'der' }),
  );
  writeFileSync(join(dir, 'server.crt'), serverCert);
  writeFileSync(
    join(dir, 'server.key'),
    serverPriv.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
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
  const gatewayTx = new GatewayTx(db.pool);
  const authority = new AuthorityService(gatewayTx, clock, {} as never);
  const mediaOptions: MediaAuthOptions = { floorMs: 80, perMinute: 60, ...options.media };

  @Global()
  @Module({
    imports: [DeviceModule, OfflineModule, SnapshotsModule],
    providers: [
      { provide: GATEWAY_CONFIG, useValue: config },
      { provide: GATEWAY_POOL, useValue: db.pool },
      { provide: GatewayTx, useValue: gatewayTx },
      { provide: GATEWAY_CLOCK, useValue: clock },
      { provide: HARDWARE_KEYSTORE, useValue: keystore },
      { provide: AUTHORITY, useValue: authority },
      EdgeQueue,
      { provide: EDGE_QUEUE, useExisting: EdgeQueue },
      { provide: APP_GUARD, useClass: ServedOperationGuard },
      { provide: DEVICE_PROOFS_OPTIONS, useValue: { failureFloorMs: 10 } },
      { provide: MEDIA_AUTH_OPTIONS, useValue: mediaOptions },
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
      DEVICE_PROOFS_OPTIONS,
      MEDIA_AUTH_OPTIONS,
    ],
  })
  class BenchModule {}

  const moduleRef = await Test.createTestingModule({ imports: [BenchModule] }).compile();
  const app = moduleRef.createNestApplication({
    httpsOptions: tlsServerOptions(config)!,
    rawBody: true,
    logger: false,
  });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  const authorityHost = `127.0.0.1:${port}`;
  config.requestAuthority = authorityHost;
  const tokens = moduleRef.get(DeviceTokenService);
  const worker = moduleRef.get(SnapshotWorker);

  const meta = (
    await db.pool.query('SELECT gateway_id, event_id, ledger_id, operator_id FROM edge_meta')
  ).rows[0] as { gateway_id: string; event_id: string; ledger_id: string; operator_id: string };
  await db.pool.query(
    `INSERT INTO edge_event_setting (id, status, currency, minor_units, timezone, activation_modes,
        terminal_settings, name, wallet_limits, offline_policy, policy_in_force)
     VALUES (true, 'LIVE', 'XOF', 0, 'Africa/Dakar', '{DESK}', '{}', 'Festival test', '{}', '{}', '[]')`,
  );
  const contentKey = randomBytes(32);

  async function issueCert(subject: string): Promise<TestDevice['cert']> {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const certPem = await deviceCa.sign(subject, publicKey.export({ type: 'spki', format: 'der' }));
    return {
      certPem,
      keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      sha256: createHash('sha256').update(new X509Certificate(certPem).raw).digest(),
    };
  }

  const bench: Bench = {
    db,
    app,
    port,
    authority: authorityHost,
    clock,
    keystore,
    worker,
    gatewayId: meta.gateway_id,
    ids: { event: meta.event_id, ledger: meta.ledger_id, operator: meta.operator_id },
    contentKey,

    async newDevice(opts = {}) {
      const deviceId = randomUUID();
      const serial = `TERM-${deviceId.slice(0, 8)}`;
      const signing = newKeyPair();
      const cert = await issueCert(`CN=${serial}`);
      const refreshToken = `drt_${randomBytes(32).toString('base64url')}`;
      const fid = randomUUID();
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      const agreement = { privateScalar: ecdh.getPrivateKey(), publicPoint: ecdh.getPublicKey() };
      await db.pool.query(
        `INSERT INTO edge_device (device_id, serial, kind, app_mode, status, public_key, cert_sha256,
           agreement_public_key, os, nfc_enabled, station_name, pos_id, pos_name, merchant_name)
         VALUES ($1, $2, 'POS', 'CATALOG_POS', 'ACTIVE', $3, $4, $5, 'ANDROID', true, 'Bar 1', $6,
                 'Bar central', 'Marchand SA')`,
        [deviceId, serial, signing.spki, cert.sha256, agreement.publicPoint, randomUUID()],
      );
      await db.pool.query(
        `INSERT INTO edge_device_token_family (fid, device_id, status, refresh_token_sha256_current)
         VALUES ($1, $2, 'ACTIVE', $3)`,
        [fid, deviceId, createHash('sha256').update(refreshToken).digest()],
      );
      const vendorSessionId = randomUUID();
      await db.pool.query(
        `INSERT INTO edge_vendor_session (vendor_session_id, vendor_id, device_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [vendorSessionId, randomUUID(), deviceId],
      );
      const policy = {
        offline_enabled: true,
        max_per_sale: 5000,
        max_per_media_per_device: 20000,
        max_total_per_device: 100000,
        max_snapshot_age_seconds: 900,
        cash_topup_offline: false,
        capped: false,
        ...opts.policy,
      };
      await db.pool.query(
        `UPDATE edge_event_setting
            SET offline_policy = offline_policy || $1::jsonb,
                policy_in_force = policy_in_force || $2::jsonb`,
        [
          JSON.stringify({ [deviceId]: { config_id: 7, ...policy } }),
          JSON.stringify([
            { device_id: deviceId, config_id: 7, in_force: true, offline_policy: policy },
          ]),
        ],
      );
      return { deviceId, serial, fid, refreshToken, signing, cert, agreement, vendorSessionId };
    },

    async setAuthority(state, epoch = 3) {
      const rows = (
        await db.pool.query('SELECT from_state, to_state FROM edge_authority_transition')
      ).rows as Array<{ from_state: string; to_state: string }>;
      const current = (await db.pool.query('SELECT state FROM edge_authority')).rows[0]
        .state as string;
      // Chemin le plus court dans la table des transitions légales.
      const queue: string[][] = [[current]];
      const seen = new Set([current]);
      let path: string[] | null = current === state ? [current] : null;
      while (!path && queue.length > 0) {
        const trail = queue.shift()!;
        for (const t of rows.filter((r) => r.from_state === trail[trail.length - 1])) {
          if (seen.has(t.to_state)) continue;
          seen.add(t.to_state);
          if (t.to_state === state) {
            path = [...trail, t.to_state];
            break;
          }
          queue.push([...trail, t.to_state]);
        }
      }
      if (!path) throw new Error(`pas de chemin ${current} -> ${state}`);
      for (const step of path.slice(1)) {
        await db.pool.query(
          `UPDATE edge_authority SET state = $1, epoch = GREATEST(epoch, $2),
                  highest_epoch_seen = GREATEST(highest_epoch_seen, $2),
                  handover_failed_epoch = CASE WHEN $1 = 'ACTIVE' THEN GREATEST(epoch, $2) END`,
          [step, epoch],
        );
      }
      await db.pool.query(
        'UPDATE edge_authority SET epoch = $1, highest_epoch_seen = GREATEST(highest_epoch_seen, $1)',
        [epoch],
      );
    },

    async setPackKey() {
      // Clé de contenu `K` scellée pour la clé d'accord de la passerelle (cf. `pack-crypto.ts`).
      const spki = await keystore.publicKey('agreement');
      const point = spki.subarray(spki.length - 65);
      const sealed = toWrappedKey(
        sealForRecipient({
          recipientPublicKey: point,
          plaintext: contentKey,
          aad: sealedKeyAad(meta.ledger_id, meta.gateway_id),
        }),
      );
      await db.pool.query(
        `INSERT INTO edge_pwd_pack_key (key_id, sealed_key) VALUES ('current', $1)
         ON CONFLICT (key_id) DO UPDATE SET sealed_key = EXCLUDED.sealed_key`,
        [Buffer.from(JSON.stringify(sealed), 'utf8')],
      );
    },

    async seedMedia(input) {
      const mediaId = randomUUID();
      const walletId = randomUUID();
      const tokenHash = randomBytes(32);
      const uid = input.uid ?? randomBytes(7);
      const keyIndex = input.keyIndex ?? 0;
      let packEnc: Buffer | null = null;
      if (input.pwdPack) {
        const nonce = randomBytes(12);
        const sealed = sealPwdPack({
          dek: contentKey,
          nonce,
          pwdPack: input.pwdPack,
          aad: pwdPackAad({ mediaId, operatorId: meta.operator_id, keyIndex, uid }),
        });
        packEnc = Buffer.from(
          JSON.stringify({
            nonce: sealed.subarray(0, 12).toString('base64'),
            ciphertext: sealed.subarray(12, 18).toString('base64'),
            tag: sealed.subarray(18).toString('base64'),
          }),
          'utf8',
        );
      }
      await db.pool.query(
        `INSERT INTO edge_wallet (wallet_id, status, central_paid, central_promo, applied_edge_seq)
         VALUES ($1, $2, $3, $4, 0)`,
        [
          walletId,
          input.walletStatus ?? 'ACTIVE',
          input.balancePaid ?? 10000,
          input.balancePromo ?? 0,
        ],
      );
      await db.pool.query(
        `INSERT INTO edge_media (token_hash, media_id, wallet_id, status, batch_id, batch_status, uid,
                                 counter_last, key_index, pwd_pack_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tokenHash,
          mediaId,
          walletId,
          input.status ?? 'ACTIVE',
          input.batchStatus === null ? null : randomUUID(),
          input.batchStatus === undefined ? 'ACTIVE' : input.batchStatus,
          uid,
          input.counterLast ?? 0,
          keyIndex,
          packEnc,
        ],
      );
      return { tokenHash, tokenHex: tokenHash.toString('hex'), uid, mediaId, walletId };
    },

    async request(device, opts) {
      const token = (
        await gatewayTx.run((tx) =>
          tokens.issue(tx, {
            deviceId: device.deviceId,
            serial: device.serial,
            familyId: device.fid,
            signingSpki: device.signing.spki,
          }),
        )
      ).token;
      const method = opts.method ?? 'GET';
      const bodyText = opts.body === undefined ? '' : JSON.stringify(opts.body);
      const body = Buffer.from(bodyText, 'utf8');
      const requestId = randomUUID();
      const headers: Record<string, string> = {
        host: authorityHost,
        'x-request-id': requestId,
        'content-digest': contentDigest(body),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        ...opts.headers,
      };
      const parts = {
        method,
        authority: authorityHost.toLowerCase(),
        path: opts.path,
        query: opts.query ?? '',
        contentDigest: headers['content-digest']!,
        requestId,
        idempotencyKey: opts.idempotencyKey ?? null,
      };
      const list = signatureParamsList(
        parts.idempotencyKey === null ? READ_COMPONENTS : WRITE_COMPONENTS,
        {
          created: Math.floor(clock.now().getTime() / 1000),
          nonce: opts.nonce ?? b64u(randomBytes(16)),
          keyid: device.deviceId,
        },
      );
      const signature = nodeSign('sha256', Buffer.from(signatureBase(parts, list), 'utf8'), {
        key: opts.signer ?? device.signing.privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      headers['signature-input'] = serializeDictionary(new Map([['dev', list]]));
      headers.signature = serializeDictionary(new Map([['dev', [signature, new Map()] as Item]]));
      headers.authorization = `Bearer ${token}`;
      const started = process.hrtime.bigint();
      return new Promise<Response>((resolve, reject) => {
        const req = https.request(
          {
            host: '127.0.0.1',
            port,
            method,
            path: opts.path + (opts.query ? `?${opts.query}` : ''),
            headers: { ...headers, 'content-length': String(body.length) },
            rejectUnauthorized: false,
            minVersion: 'TLSv1.3',
            cert: device.cert.certPem,
            key: device.cert.keyPem,
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

    async q(sql, params = []) {
      return (await db.pool.query(sql, params)).rows;
    },

    async close() {
      await worker.stop();
      await app.close();
      await db.drop();
    },
  };
  return bench;
}

// ---------------------------------------------------------------------------------------------------------
// Lots de terminal
// ---------------------------------------------------------------------------------------------------------
export interface BatchOpSpec {
  type?: 'PURCHASE' | 'REVERSAL' | 'TOPUP_CASH' | 'VOID' | 'ONLINE_REF';
  amount?: number;
  media?: SeedMediaResult;
  /** Surcharge de champs de l'opération. */
  extra?: Record<string, unknown>;
  occurredAt?: Date;
  /** Corrompt le chaînon déclaré de cette opération. */
  corruptChain?: boolean;
}

export interface BuiltBatch {
  body: {
    header: Record<string, unknown>;
    operations: Record<string, unknown>[];
    signature: string;
  };
  batchId: string;
  header: Record<string, unknown>;
}

/** Construit et signe (DER) un lot de terminal, chaîne recalculée avec le code partagé. */
export function buildDeviceBatch(
  bench: Bench,
  device: OfflineDevice,
  specs: BatchOpSpec[],
  opts: {
    seqFrom?: number;
    snapshotVersion?: number;
    configId?: number;
    epoch?: number;
    signer?: KeyObject;
    batchId?: string;
    prev?: string;
  } = {},
): BuiltBatch {
  const seqFrom = opts.seqFrom ?? 1;
  const prev = opts.prev ?? randomBytes(32).toString('hex');
  let chain: Buffer = Buffer.from(prev, 'hex');
  const now = bench.clock.now();
  const operations = specs.map((spec, i) => {
    const seq = seqFrom + i;
    const type = spec.type ?? 'PURCHASE';
    const occurred = (spec.occurredAt ?? new Date(now.getTime() - 1000)).toISOString();
    const op: Record<string, unknown> = { seq, type, occurred_at: occurred };
    if (type === 'PURCHASE') {
      op.amount = spec.amount ?? 500;
      op.currency = 'XOF';
      op.tap = {
        nfc_uid: spec.media!.uid.toString('hex'),
        token_hash: spec.media!.tokenHex,
        counter: seq,
        key_index: 0,
        pack_verified: true,
        occurred_at: occurred,
      };
    }
    if (type === 'PURCHASE' || type === 'REVERSAL') {
      op.snapshot_version = opts.snapshotVersion;
      op.vendor_session_id = device.vendorSessionId;
      op.config_id = opts.configId ?? 7;
    }
    if (type === 'TOPUP_CASH') {
      op.amount = spec.amount ?? 1000;
      op.currency = 'XOF';
    }
    if (type === 'VOID') op.void_reason = 'ABANDONED';
    Object.assign(op, spec.extra ?? {});
    chain = chainStep(chain, contentSha256(chainedContent(op)));
    op.chain_hash = spec.corruptChain ? randomBytes(32).toString('hex') : chain.toString('hex');
    return op;
  });
  const batchId = opts.batchId ?? randomUUID();
  const header: Record<string, unknown> = {
    batch_id: batchId,
    device_serial: device.serial,
    ledger_id: bench.ids.ledger,
    authority_epoch: opts.epoch ?? 3,
    seq_from: seqFrom,
    seq_to: seqFrom + specs.length - 1,
    count: specs.length,
    created_at: now.toISOString(),
    prev_chain_hash: prev,
    last_chain_hash: chain.toString('hex'),
  };
  const signature = nodeSign('sha256', Buffer.from(canonicalize(header)!, 'utf8'), {
    key: opts.signer ?? device.signing.privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
  return { body: { header, operations, signature }, batchId, header };
}

export function submit(
  bench: Bench,
  device: OfflineDevice,
  built: BuiltBatch,
  opts: { epoch?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  return bench.request(device, {
    method: 'POST',
    path: '/v1/offline-batches',
    body: built.body,
    idempotencyKey: built.batchId,
    headers: {
      'x-authority-epoch': String(opts.epoch ?? built.header.authority_epoch),
      'x-device-serial': device.serial,
      ...opts.headers,
    },
  });
}

/** Active l'autorité, accorde un snapshot FULL et rend sa version. */
export async function readySnapshot(bench: Bench): Promise<number> {
  await bench.setAuthority('ACTIVE');
  await bench.setPackKey();
  const out = await bench.worker.tick();
  if (!out) throw new Error('aucun snapshot produit');
  return out.version;
}

export function genesis(bench: Bench): string {
  return edgeChainGenesis(bench.gatewayId).toString('hex');
}

export { createPublicKey, toWrappedKey };
