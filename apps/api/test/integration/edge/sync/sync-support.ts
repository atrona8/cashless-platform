// Outils des suites de réception `EDGE_SYNC` (WP13) : site de test (passerelle, terminal,
// portefeuilles posés par le
// propriétaire), lots signés comme le ferait une passerelle, accès central de TEST (lit et écrit
// par la connexion du
// propriétaire : le rôle `cashless_edge` n'a aucun droit de table, voir `edge-sync-
// central.port.ts`), démarrage du
// processus `edge` avec ces faux, requêtes HTTPS. Les faux portent `isFake = true`.
import 'reflect-metadata';
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  batchSigningPayload,
  chainStep,
  edgeChainGenesis,
  edgeContentSha256,
} from '@cashless/shared-rules';
import type { Client } from 'pg';
import type { EdgeGateway } from '../../../../src/edge/auth/edge-gateway';
import {
  EDGE_SYNC_CENTRAL,
  type CentralAudit,
  type DeviceFacts,
  type EdgeSyncCentral,
  type FeeInput,
  type FeeLine,
  type StoredResult,
  type SyncCursor,
} from '../../../../src/edge/sync/edge-sync-central.port';
import {
  TAP_PROOF_VERIFIER,
  type TapProofInput,
  type TapProofVerifier,
} from '../../../../src/edge/sync/tap-proof.port';
import { serve } from '../../../../src/processes/bootstrap';
import { EdgeProcessModule } from '../../../../src/processes/edge.module';
import { connect, EDGE_URL, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  edgeTls,
  newEvent,
  type ClientCert,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';

export interface Signer {
  spki: Buffer;
  /** Signature DER (base64) de `data`. */
  sign(data: Buffer): string;
  privateKey: KeyObject;
}

export function newSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    spki: publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    privateKey,
    sign: (data) =>
      createSign('sha256')
        .update(data)
        .sign({ key: privateKey, dsaEncoding: 'der' })
        .toString('base64'),
  };
}

export interface Wallet {
  n: number;
  walletId: string;
  tokenHash: string;
  nfcUid: string;
  signature: string;
  counter: number;
}

/** Un événement, sa passerelle `PRIMARY` à l'autorité (époque 1), un terminal et des portefeuilles. */
export interface Site {
  operatorId: string;
  eventId: string;
  ledgerId: string;
  gatewayId: string;
  cert: ClientCert;
  gwKey: Signer;
  deviceSerial: string;
  deviceKey: Signer;
  deviceId: string;
  participationId: string;
  organizerId: string;
  wallets: Map<number, Wallet>;
  /** État de la passerelle simulée : prochain `edge_seq`, chaîne, prochain `seq` du terminal. */
  nextEdgeSeq: bigint;
  chain: Buffer;
  nextSeq: number;
}

let siteCounter = 0;

export async function seedSite(
  owner: Client,
  world: EdgeWorld,
  walletSpecs: Array<[number, number]> = [[1, 1_000_000]],
): Promise<Site> {
  const { edgeCa } = await edgeTls();
  const { eventId, ledgerId } = await newEvent(owner, world);
  const cert = await edgeCa.issue(`gw-${randomUUID().slice(0, 8)}`);
  const gatewayId = await addGateway(owner, world, eventId, { sha256: cert.sha256 });
  const gwKey = newSigner();
  const deviceKey = newSigner();
  await owner.query(`UPDATE edge_gateway SET public_key = $2 WHERE id = $1`, [
    gatewayId,
    gwKey.spki,
  ]);
  await owner.query(
    `UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = $2, authority_epoch = 1 WHERE id = $1`,
    [ledgerId, gatewayId],
  );
  await owner.query(
    `INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
       watermark_posting_id, requested_by) VALUES ($1, $2, $3, 'TO_EDGE', 'ACTIVE', 1, 0, $4)`,
    [world.operatorId, ledgerId, gatewayId, randomUUID()],
  );
  const { rows: ev } = await owner.query<{ organizer_id: string }>(
    `SELECT organizer_id FROM event WHERE id = $1`,
    [eventId],
  );
  const organizerId = ev[0]!.organizer_id;
  const merchant = randomUUID();
  const participationId = randomUUID();
  const pos = randomUUID();
  const deviceId = randomUUID();
  siteCounter += 1;
  const deviceSerial = `TPE-${siteCounter}-${randomUUID().slice(0, 6)}`;
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  await owner.query(
    `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'MERCHANT', $2, 'Commerçant')`,
    [merchant, world.operatorId],
  );
  await owner.query(
    `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
     VALUES ($1, $2, $3, $4, 'INTERNAL', $5)`,
    [participationId, world.operatorId, eventId, merchant, organizerId],
  );
  await owner.query(
    `INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES ($1, $2, $3, 'Stand')`,
    [pos, world.operatorId, participationId],
  );
  await owner.query(`SELECT open_participation_account($1)`, [participationId]);
  await owner.query(
    `INSERT INTO device (id, operator_id, kind, event_id, pos_id, serial, public_key)
     VALUES ($1, $2, 'POS', $3, $4, $5, $6)`,
    [deviceId, world.operatorId, eventId, pos, deviceSerial, deviceKey.spki],
  );
  const site: Site = {
    operatorId: world.operatorId,
    eventId,
    ledgerId,
    gatewayId,
    cert,
    gwKey,
    deviceSerial,
    deviceKey,
    deviceId,
    participationId,
    organizerId,
    wallets: new Map(),
    nextEdgeSeq: 1n,
    chain: edgeChainGenesis(gatewayId),
    nextSeq: 1,
  };
  for (const [n, paid] of walletSpecs) await addWallet(owner, site, n, paid);
  return site;
}

export async function addWallet(
  owner: Client,
  site: Site,
  n: number,
  paid: number,
): Promise<Wallet> {
  const walletId = randomUUID();
  const tokenHash = createHash('sha256').update(`identité ${walletId}`).digest('hex');
  const nfcUid = `0461${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const signature = `sig-${walletId}`;
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [site.operatorId]);
  await owner.query(
    `INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [walletId, site.operatorId, site.ledgerId],
  );
  await owner.query(
    `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
       ($1, $2, $3, 'CLAIM', 'WALLET_PAID', $4, 'C'), ($1, $2, $5, 'CLAIM', 'WALLET_PROMO', $4, 'C')`,
    [site.operatorId, site.ledgerId, `L-WAL-${n}-P`, walletId, `L-WAL-${n}-X`],
  );
  await owner.query(
    `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status, originality_sig_sha256)
     VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 'ACTIVE', sha256($6::bytea))`,
    [
      randomUUID(),
      site.operatorId,
      Buffer.from(tokenHash, 'hex'),
      Buffer.from(nfcUid, 'hex'),
      walletId,
      Buffer.from(signature),
    ],
  );
  if (paid > 0)
    await owner.query(
      `SELECT post_transaction($1, 'TOPUP', $2, now(), 'BATCH', jsonb_build_array(
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', -$4::bigint),
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'), 'amount', $4::bigint)))`,
      [site.ledgerId, `fund-${walletId}`, `L-WAL-${n}-P`, paid],
    );
  const wallet = { n, walletId, tokenHash, nfcUid, signature, counter: 0 };
  site.wallets.set(n, wallet);
  return wallet;
}

export const iso = (offsetSeconds = 0): string =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface OpOptions {
  amount?: number;
  type?: string;
  mode?: 'EDGE_ONLINE' | 'DEVICE_OFFLINE';
  wallet?: number;
  /** Pas de `tap`. */
  noTap?: boolean;
  /** Surcharge de champs de l'opération (avant le calcul du maillon). */
  patch?: Record<string, unknown>;
  tapPatch?: Record<string, unknown>;
  charged?: number;
  shortfall?: number;
  deviceBatchId?: string;
}

/** Une opération telle que la passerelle l'enverrait ; consomme `edge_seq`, `seq` et le compteur du bracelet. */
export function makeOp(site: Site, options: OpOptions = {}): Record<string, unknown> {
  const type = options.type ?? 'PURCHASE';
  const amount = options.amount ?? 1000;
  const op: Record<string, unknown> = {
    edge_seq: Number(site.nextEdgeSeq),
    device_serial: site.deviceSerial,
    authorized_mode: options.mode ?? 'EDGE_ONLINE',
    seq: site.nextSeq,
    type,
    occurred_at: iso(-5),
  };
  site.nextSeq += 1;
  if (type === 'PURCHASE' || type === 'REVERSAL' || type === 'TOPUP_CASH') {
    op.amount = amount;
    op.currency = 'XOF';
    op.edge_decision = {
      status: options.shortfall ? 'ACCEPTED_WITH_SHORTFALL' : 'ACCEPTED',
      charged_to_wallet: options.charged ?? amount - (options.shortfall ?? 0),
      shortfall_amount: options.shortfall ?? 0,
      ...(options.shortfall ? { shortfall_reason: 'INSUFFICIENT_FUNDS' } : {}),
    };
  }
  if (type === 'VOID') {
    op.void_reason = 'ABORTED_BY_OPERATOR';
    op.edge_decision = { status: 'ACCEPTED', charged_to_wallet: 0, shortfall_amount: 0 };
  }
  if (!options.noTap && (type === 'PURCHASE' || type === 'REVERSAL')) {
    const wallet = site.wallets.get(options.wallet ?? 1)!;
    wallet.counter += 1;
    op.tap = {
      nfc_uid: wallet.nfcUid,
      token_hash: wallet.tokenHash,
      counter: wallet.counter,
      key_index: 1,
      pack_verified: true,
      originality_signature: Buffer.from(wallet.signature).toString('base64'),
      occurred_at: iso(-5),
      ...options.tapPatch,
    };
  }
  if (options.deviceBatchId) op.device_batch_id = options.deviceBatchId;
  Object.assign(op, options.patch);
  site.nextEdgeSeq += 1n;
  return op;
}

export interface BatchOptions {
  batchId?: string;
  /** Ne pas avancer l'état de la passerelle simulée (lot rejoué ou refusé). */
  keepState?: boolean;
  epoch?: number;
  patch?: Record<string, unknown>;
  prev?: Buffer;
  signWith?: Signer;
  extra?: Record<string, unknown>;
  /** Ne pas recalculer les maillons `chain_hash` (laisse ceux de l'opération). */
  rawChain?: boolean;
}

/** Lot signé : maillons recalculés par la passerelle simulée, `last_chain_hash`, signature. */
export function makeBatch(site: Site, ops: Array<Record<string, unknown>>, o: BatchOptions = {}) {
  const prev = o.prev ?? site.chain;
  let chain = prev;
  for (const op of ops) {
    chain = chainStep(chain, edgeContentSha256(op as never));
    if (!o.rawChain && op.authorized_mode === 'EDGE_ONLINE') op.chain_hash = chain.toString('hex');
  }
  // Lot sans opération (ADR-187) : l'intervalle est vide, `edge_seq_to = edge_seq_from - 1`.
  const first = ops.length > 0 ? (ops[0]!.edge_seq as number) : Number(site.nextEdgeSeq);
  const batch: Record<string, unknown> = {
    batch_id: o.batchId ?? randomUUID(),
    edge_gateway_id: site.gatewayId,
    ledger_id: site.ledgerId,
    epoch: o.epoch ?? 1,
    edge_seq_from: first,
    edge_seq_to: first + ops.length - 1,
    prev_chain_hash: prev.toString('hex'),
    last_chain_hash: chain.toString('hex'),
    operations: ops,
    ...o.extra,
    ...o.patch,
  };
  batch.signature = (o.signWith ?? site.gwKey).sign(batchSigningPayload(batch));
  if (!o.keepState) site.chain = chain;
  return batch;
}

/** Fabrique et signe d'un coup `n` ventes. */
export const purchases = (site: Site, n: number, options: OpOptions = {}) =>
  Array.from({ length: n }, () => makeOp(site, options));

export const resign = (site: Site, batch: Record<string, unknown>, signer?: Signer): void => {
  batch.signature = (signer ?? site.gwKey).sign(batchSigningPayload(batch));
};

// ------------------------------------------------------------------------------------------ accès
// central de test

/** Accès central de test : connexion du propriétaire. Compte les appels pour les tests. */
export class TestCentral implements EdgeSyncCentral {
  readonly isFake = true;
  feeProvider: ((input: FeeInput) => Promise<FeeLine[]>) | null = null;
  calls = { feeLines: 0 };
  constructor(private readonly owner: Client) {}

  async cursor(g: EdgeGateway): Promise<SyncCursor> {
    const { rows } = await this.owner.query(
      `SELECT contiguous_edge_seq, last_chain_hash FROM edge_gateway WHERE id = $1`,
      [g.gatewayId],
    );
    return {
      contiguousEdgeSeq: BigInt(rows[0].contiguous_edge_seq),
      lastChainHash: rows[0].last_chain_hash ?? null,
    };
  }

  async device(g: EdgeGateway, serial: string): Promise<DeviceFacts | null> {
    const { rows } = await this.owner.query(
      `SELECT id, public_key, status FROM device WHERE serial = $1 AND event_id = $2
        ORDER BY (status <> 'REVOKED') DESC LIMIT 1`,
      [serial, g.eventId],
    );
    return rows[0]
      ? { deviceId: rows[0].id, publicKey: rows[0].public_key, status: rows[0].status }
      : null;
  }

  async feeLines(_g: EdgeGateway, input: FeeInput): Promise<FeeLine[]> {
    this.calls.feeLines += 1;
    return this.feeProvider ? this.feeProvider(input) : [];
  }

  async results(_g: EdgeGateway, batchId: string): Promise<StoredResult[]> {
    const { rows } = await this.owner.query(
      `SELECT edge_seq, outcome, reason, detail, transaction_id, retryable
         FROM edge_sync_batch_result WHERE batch_id = $1 ORDER BY edge_seq`,
      [batchId],
    );
    return rows.map((r) => ({
      edgeSeq: BigInt(r.edge_seq),
      outcome: r.outcome,
      reason: r.reason,
      detail: r.detail,
      transactionId: r.transaction_id,
      retryable: r.retryable,
    }));
  }

  async audit(g: EdgeGateway, entry: CentralAudit): Promise<void> {
    const orderSha = (entry.detail as { order_sha256?: string }).order_sha256;
    if (orderSha) {
      const { rows } = await this.owner.query(
        `SELECT 1 FROM audit_log WHERE action = $1 AND after ->> 'batch_id' = $2 AND after #>> '{detail,order_sha256}' = $3`,
        [entry.action, entry.batchId, orderSha],
      );
      if (rows.length > 0) return;
    }
    await this.owner.query(
      `INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
       VALUES ($1, NULL, 'edge', $2, 'EDGE_GATEWAY', $3, $4, 'edge')`,
      [
        g.operatorId,
        entry.action,
        g.gatewayId,
        JSON.stringify({ batch_id: entry.batchId, detail: entry.detail }),
      ],
    );
  }
}

/** Preuve de passage de test : empreinte de la signature = celle de la personnalisation (comme `register_tap`). */
export class TestTapProof implements TapProofVerifier {
  readonly isFake = true;
  constructor(private readonly owner: Client) {}
  async verify(_g: EdgeGateway, input: TapProofInput): Promise<boolean> {
    if (input.originalitySignature === null) return false;
    const { rows } = await this.owner.query(
      `SELECT originality_sig_sha256 = sha256($2::bytea) AS ok FROM media
        WHERE token_hash = $1 AND nfc_uid = $3`,
      [input.tokenHash, input.originalitySignature, input.nfcUid],
    );
    return rows[0]?.ok === true;
  }
}

// -------------------------------------------------------------------------------------------------
// ----- démarrage

export interface SyncEdge extends RunningEdge {
  /** Absent quand les adaptateurs de production (fonctions SQL sous `cashless_edge`) sont gardés. */
  central: TestCentral | undefined;
  owner: Client;
}

/**
 * `serve(EdgeProcessModule)` avec les deux ports remplacés par les faux de test ; sans faux (`undefined`), les adaptateurs
 * de production restent en place et tout passe par les fonctions SQL étroites sous la connexion `cashless_edge`.
 */
export async function startSyncEdge(
  central: TestCentral | undefined,
  tapProof: TapProofVerifier | undefined,
  owner: Client,
): Promise<SyncEdge> {
  const { tls, edgeCaCertFile } = await edgeTls();
  const keys = [
    'EDGE_TLS_CERT_FILE',
    'EDGE_TLS_KEY_FILE',
    'EDGE_CA_CERT_FILE',
    'DATABASE_URL_EDGE',
  ];
  const saved = keys.map((k) => [k, process.env[k]] as const);
  process.env.EDGE_TLS_CERT_FILE = tls.tlsCertFile;
  process.env.EDGE_TLS_KEY_FILE = tls.tlsKeyFile;
  process.env.EDGE_CA_CERT_FILE = edgeCaCertFile;
  process.env.DATABASE_URL_EDGE = EDGE_URL;
  const create = jest.spyOn(NestFactory, 'create').mockImplementation((async (
    module: never,
    options: never,
  ) => {
    let builder = Test.createTestingModule({ imports: [module] });
    if (central) builder = builder.overrideProvider(EDGE_SYNC_CENTRAL).useValue(central);
    if (tapProof) builder = builder.overrideProvider(TAP_PROOF_VERIFIER).useValue(tapProof);
    const moduleRef = await builder.compile();
    return moduleRef.createNestApplication(options);
  }) as never);
  try {
    await serve(EdgeProcessModule, 0, { listener: 'edge' });
    const app = (await create.mock.results[0]!.value) as INestApplication;
    return {
      app,
      central,
      owner,
      port: (app.getHttpServer().address() as AddressInfo).port,
      close: async () => {
        await app.close();
      },
    };
  } finally {
    create.mockRestore();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export interface PostReply {
  status: number;
  json: Record<string, any> | null;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export async function edgePost(
  port: number,
  cert: ClientCert,
  payload: unknown,
  options: { idempotencyKey?: string | null; raw?: Buffer } = {},
): Promise<PostReply> {
  const { tls } = await edgeTls();
  const body = options.raw ?? Buffer.from(JSON.stringify(payload));
  const batchId = (payload as { batch_id?: string } | undefined)?.batch_id;
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    'content-length': body.length,
  };
  const key = options.idempotencyKey === undefined ? batchId : options.idempotencyKey;
  if (key) headers['idempotency-key'] = key;
  return new Promise<PostReply>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/edge/sync-batches',
        method: 'POST',
        ca: tls.serverCaPem,
        servername: 'localhost',
        cert: cert.certPem,
        key: cert.keyPem,
        headers,
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, any> | null = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers, body: text });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Connexion du propriétaire (données de test). `check_balanced` est DEFINER depuis la migration 0066. */
export const openOwner = (): Promise<Client> => connect(OWNER_URL);
