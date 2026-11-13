import 'reflect-metadata';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CentralClient } from '../../../src/central-client/central-client';
import { AuthorityService } from '../../../src/authority/authority.service';
import { ControlChannel } from '../../../src/authority/control-channel';
import { DbQueueProbe } from '../../../src/authority/db-ports';
import type { DrainSignal, ReplicationCatchUp } from '../../../src/authority/ports';
import { orderBytes, type OrderPayload } from '../../../src/authority/site-order';
import type { GatewayClock } from '../../../src/clock/gateway-clock';
import type { GatewayConfig } from '../../../src/config/config';
import { GatewayTx } from '../../../src/db/gateway-tx';
import { createTestDb, type TestDb } from '../../startup/_support/db';
import { enrolledFixture, tempDir } from '../../startup/_support/fixture';
import { FakeCentral, selfSigned } from './central';

export class TestClock implements GatewayClock {
  current = new Date('2026-11-06T12:00:00Z');
  ackRefused = false;
  observed: Date[] = [];
  now(): Date {
    return new Date(this.current);
  }
  async observeCentral(date: Date): Promise<void> {
    this.observed.push(date);
  }
  skewAlert(): boolean {
    return false;
  }
  refusesAck(): boolean {
    return this.ackRefused;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface SiteKey {
  holder: string;
  publicKey: string;
  privateKey: KeyObject;
}

export function makeSiteKey(holder: string): SiteKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    holder,
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey,
  };
}

export function signOrder(
  order: OrderPayload,
  key: SiteKey,
): { holder: string; signature: string } {
  return {
    holder: key.holder,
    signature: sign('sha256', orderBytes(order), {
      key: key.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

export class RecordingDrain implements DrainSignal {
  calls: Array<{ missingEdgeSeqs?: number[] } | undefined> = [];
  requestDrain(hint?: { missingEdgeSeqs?: number[] }): void {
    this.calls.push(hint);
  }
}

export interface Harness {
  db: TestDb;
  gatewayId: string;
  central: FakeCentral;
  clock: TestClock;
  tx: GatewayTx;
  client: CentralClient;
  config: GatewayConfig;
  authority: AuthorityService;
  channel: ControlChannel;
  drain: RecordingDrain;
  siteKeys: [SiteKey, SiteKey];
  /** Nouvelle instance de service/canal sur la MÊME base : simule un redémarrage. */
  restart(): { authority: AuthorityService; channel: ControlChannel };
  setCatchUp(catchUp: ReplicationCatchUp | undefined): void;
  close(): Promise<void>;
}

export async function makeHarness(
  options: { catchUp?: ReplicationCatchUp } = {},
): Promise<Harness> {
  const db = await createTestDb();
  const central = await FakeCentral.start();
  const siteKeys: [SiteKey, SiteKey] = [makeSiteKey('Responsable A'), makeSiteKey('Responsable B')];
  const fixture = await enrolledFixture(db, {
    central_ca_pem: central.cert.certPem,
    central_url: central.url,
    site_order_keys: [
      { holder: siteKeys[0].holder, public_key: siteKeys[0].publicKey },
      { holder: siteKeys[1].holder, public_key: siteKeys[1].publicKey },
    ],
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
  const drain = new RecordingDrain();
  let catchUp = options.catchUp;
  const client = new CentralClient(config, tx, clock);
  const build = (): { authority: AuthorityService; channel: ControlChannel } => {
    const authority = new AuthorityService(tx, clock, client, drain);
    const channel = new ControlChannel(
      authority,
      client,
      clock,
      tx,
      new DbQueueProbe(tx),
      catchUp,
      drain,
    );
    return { authority, channel };
  };
  const first = build();
  return {
    db,
    gatewayId: fixture.file.gateway_id,
    central,
    clock,
    tx,
    client,
    config,
    authority: first.authority,
    channel: first.channel,
    drain,
    siteKeys,
    restart: build,
    setCatchUp(next) {
      catchUp = next;
    },
    async close() {
      await first.channel.stop();
      await central.stop();
      await db.drop();
    },
  };
}

/** Pose l'état directement (le déclencheur de transitions est suspendu le temps de l'écriture). */
export async function forceAuthority(
  db: TestDb,
  patch: Record<string, string | number | boolean | Date | null>,
): Promise<void> {
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function authorityRow(db: TestDb): Promise<Record<string, any>> {
  return (await db.pool.query('SELECT * FROM edge_authority')).rows[0];
}

export async function auditKinds(db: TestDb): Promise<string[]> {
  return (await db.pool.query('SELECT kind FROM edge_audit ORDER BY id')).rows.map(
    (r: { kind: string }) => r.kind,
  );
}

/** Ajoute `count` opérations à la file, toutes acquittées (le rendu exige une file vide). */
export async function appendAckedOps(db: TestDb, count: number, acked = true): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const head = (await db.pool.query('SELECT last_edge_seq FROM edge_chain_head')).rows[0];
    const seq = Number(head.last_edge_seq) + 1;
    const hash = Buffer.alloc(32, seq % 251);
    await db.pool.query(
      `INSERT INTO edge_op (edge_seq, origin_key, type, authorized_mode, device_serial, device_id,
                            operation, content_sha256, chain_hash, occurred_at, recorded_at)
       VALUES ($1, $2, 'PURCHASE', 'EDGE_ONLINE', 'T-1', gen_random_uuid(), '{}', $3, $3,
               now(), now())`,
      [seq, `op-${seq}-${Math.random()}`, hash],
    );
    await db.pool.query(
      acked
        ? `UPDATE edge_chain_head SET last_edge_seq = $1, last_chain_hash = $2, acked_edge_seq = $1,
                  acked_chain_hash = $2`
        : `UPDATE edge_chain_head SET last_edge_seq = $1, last_chain_hash = $2`,
      [seq, hash],
    );
  }
}
