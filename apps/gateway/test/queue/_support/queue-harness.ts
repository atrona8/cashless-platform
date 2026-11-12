import 'reflect-metadata';
// Banc de la file : base jetable enrôlée, faux central HTTPS (mTLS), faux port matériel, vraie
// `EdgeQueue`, vrai `DrainService`.
import { createVerify, createPublicKey, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batchSigningPayload } from '@cashless/shared-rules';
import { CentralClient } from '../../../src/central-client/central-client';
import type { GatewayConfig } from '../../../src/config/config';
import { GatewayTx, type TxClient } from '../../../src/db/gateway-tx';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import { DrainService } from '../../../src/queue/drain.service';
import { EdgeQueue, type EdgeOpInput, type WalletDelta } from '../../../src/queue/edge-queue';
import type { DeltaPurgePort } from '../../../src/queue/result-applier';
import {
  FakeCentral,
  selfSigned,
  type Recorded,
  type Reply,
} from '../../authority/_support/central';
import { TestClock } from '../../authority/_support/harness';
import { createTestDb, type TestDb } from '../../startup/_support/db';
import { enrolledFixture, tempDir } from '../../startup/_support/fixture';

export const DEVICE_ID = '99999999-9999-4999-8999-999999999999';
export const SERIAL = 'TPE-BAR-01';

export class RecordingPurge implements DeltaPurgePort {
  calls: Array<{ edgeSeq: number; status: string }> = [];
  async onOpResult(_tx: TxClient, edgeSeq: number, status: string): Promise<void> {
    this.calls.push({ edgeSeq, status });
  }
}

export interface QueueHarness {
  db: TestDb;
  gatewayId: string;
  ledgerId: string;
  central: FakeCentral;
  clock: TestClock;
  tx: GatewayTx;
  keystore: FakeHardwareKeystore;
  queue: EdgeQueue;
  drain: DrainService;
  purge: RecordingPurge;
  drained: number;
  add(count: number, options?: AddOptions): Promise<void>;
  addOp(input: EdgeOpInput, deltas?: WalletDelta[]): Promise<number>;
  close(): Promise<void>;
}

export interface AddOptions {
  from?: number;
  padding?: number;
  type?: 'PURCHASE' | 'TOPUP_CASH';
}

export function purchase(seq: number, padding = 0): EdgeOpInput {
  return {
    originKey: `${SERIAL}:${seq}`,
    type: 'PURCHASE',
    authorizedMode: 'EDGE_ONLINE',
    deviceSerial: SERIAL,
    deviceId: DEVICE_ID,
    operation: {
      seq,
      type: 'PURCHASE',
      occurred_at: '2026-12-12T08:00:00Z',
      amount: 100,
      currency: 'XOF',
      edge_decision: { status: 'ACCEPTED', charged_to_wallet: 100, shortfall_amount: 0 },
      ...(padding > 0 ? { lines: [{ product_id: 'p', note: 'x'.repeat(padding) }] } : {}),
    },
    occurredAt: new Date('2026-12-12T08:00:00Z'),
    recordedAt: new Date('2026-12-12T08:00:01Z'),
  };
}

export async function makeQueueHarness(
  options: { purge?: DeltaPurgePort } = {},
): Promise<QueueHarness> {
  const db = await createTestDb();
  const central = await FakeCentral.start();
  const fixture = await enrolledFixture(db, {
    central_ca_pem: central.cert.certPem,
    central_url: central.url,
  });
  const dir = tempDir();
  const clientCert = await selfSigned('gateway-client');
  writeFileSync(join(dir, 'client.crt'), clientCert.certPem);
  writeFileSync(join(dir, 'client.key'), clientCert.keyPem, { mode: 0o600 });
  const config = {
    production: false,
    centralUrl: null,
    centralClientCertFile: join(dir, 'client.crt'),
    centralClientKeyFile: join(dir, 'client.key'),
  } as unknown as GatewayConfig;
  const tx = new GatewayTx(db.pool);
  const clock = new TestClock();
  const client = new CentralClient(config, tx, clock);
  const keystore = new FakeHardwareKeystore();
  const purge = new RecordingPurge();
  const drain = new DrainService(tx, client, keystore, clock, options.purge ?? purge);
  const queue = new EdgeQueue();
  const harness: QueueHarness = {
    db,
    gatewayId: fixture.file.gateway_id,
    ledgerId: fixture.file.ledger_id,
    central,
    clock,
    tx,
    keystore,
    queue,
    drain,
    purge,
    drained: 0,
    async addOp(input, deltas = []) {
      return tx.run(async (t) => (await queue.append(t, input, deltas)).edgeSeq);
    },
    async add(count, opts = {}) {
      const first =
        opts.from ??
        Number(
          (await db.pool.query('SELECT last_edge_seq FROM edge_chain_head')).rows[0].last_edge_seq,
        ) + 1;
      await tx.run(async (t) => {
        for (let i = 0; i < count; i += 1) {
          await queue.append(t, purchase(first + i, opts.padding ?? 0), []);
        }
      });
    },
    async close() {
      await central.stop();
      await db.drop();
    },
  };
  drain.bindHooks({ onDrained: () => (harness.drained += 1) });
  return harness;
}

/** Réponse type du central : `ACCEPTED` pour toutes les opérations du lot reçu. */
export function acceptAll(
  request: Recorded,
  overrides: Record<string, (op: Record<string, unknown>) => Record<string, unknown>> = {},
  extra: Record<string, unknown> = {},
): Reply {
  const batch = request.body as { batch_id: string; operations: Array<Record<string, unknown>> };
  return {
    status: 200,
    body: {
      batch_id: batch.batch_id,
      processed_at: '2026-12-12T09:00:00Z',
      results: batch.operations.map((op) => {
        const key = `${String(op.device_serial)}:${String(op.seq)}`;
        const base = {
          seq: op.seq,
          idempotency_key: key,
          status: 'ACCEPTED',
          transaction_id: randomUUID(),
          effect: 'LEDGER_WRITTEN',
          retryable: false,
        };
        return overrides[key] ? overrides[key]!(base) : base;
      }),
      contiguous_acked_seq: 0,
      missing_seqs: [],
      server_time: '2026-12-12T09:00:00Z',
      ...extra,
    },
  };
}

export function verifyBatchSignature(
  body: Record<string, unknown>,
  publicKeySpki: Buffer,
): boolean {
  const { signature, ...rest } = body;
  const key = createPublicKey({ key: publicKeySpki, format: 'der', type: 'spki' });
  return createVerify('sha256')
    .update(batchSigningPayload(rest))
    .verify({ key, dsaEncoding: 'der' }, Buffer.from(String(signature), 'base64'));
}

export async function ops(db: TestDb): Promise<Array<Record<string, any>>> {
  return (await db.pool.query('SELECT * FROM edge_op ORDER BY edge_seq')).rows;
}
export async function head(db: TestDb): Promise<Record<string, any>> {
  return (await db.pool.query('SELECT * FROM edge_chain_head')).rows[0];
}
export async function batches(db: TestDb): Promise<Array<Record<string, any>>> {
  return (await db.pool.query('SELECT * FROM edge_outgoing_batch ORDER BY sent_at NULLS LAST'))
    .rows;
}
export async function auditKinds(db: TestDb): Promise<string[]> {
  return (await db.pool.query('SELECT kind FROM edge_audit ORDER BY id')).rows.map((r) => r.kind);
}
