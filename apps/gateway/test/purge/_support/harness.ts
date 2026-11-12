import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { LocalOrdersController } from '../../../src/admin/local-orders.controller';
import { DbQueueProbe } from '../../../src/authority/db-ports';
import type { DrainSignal } from '../../../src/authority/ports';
import type { GatewayConfig } from '../../../src/config/config';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import { ManualPurgeController } from '../../../src/purge/manual-purge.controller';
import { PurgeGate, PurgeMarkerFile } from '../../../src/purge/purge-marker';
import { PurgeRuntime } from '../../../src/purge/purge.module';
import { PurgeTrigger } from '../../../src/purge/purge-trigger';
import { PurgeService, type PurgeStepHook, type Quiescer } from '../../../src/purge/purge.service';
import { makeHarness, type Harness } from '../../authority/_support/harness';
import { adminUrl } from '../../startup/_support/db';

export const CANARY = `CANARI-MDP'"\\-0123456789`;
export const CANARY_BYTES = createHash('sha256').update('canari-jeton').digest();

/** Toutes les représentations du canari texte et du canari binaire. */
export function representations(): Buffer[] {
  const out: Buffer[] = [];
  const text = Buffer.from(CANARY, 'utf8');
  for (const raw of [text, CANARY_BYTES]) {
    out.push(
      raw,
      Buffer.from(raw.toString('hex')),
      Buffer.from(raw.toString('hex').toUpperCase()),
      Buffer.from(raw.toString('base64')),
      Buffer.from(raw.toString('base64url')),
    );
  }
  out.push(
    Buffer.from(JSON.stringify(CANARY).slice(1, -1)),
    Buffer.from(CANARY.replace(/'/g, "''")),
    Buffer.from(JSON.stringify(CANARY).slice(1, -1).replace(/'/g, "''")),
  );
  return out;
}

export function found(haystack: Buffer): number[] {
  return representations()
    .map((needle, index) => (haystack.includes(needle) ? index : -1))
    .filter((index) => index >= 0);
}

/** Dump logique (`pg_dump`) + fichiers de la base (tas et TOAST) lus par un superutilisateur. */
export async function scanDatabase(dbName: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  const dump = '/Library/PostgreSQL/18/bin/pg_dump';
  if (existsSync(dump)) {
    parts.push(
      execFileSync(dump, ['--inserts', '--dbname', adminUrl('5433', dbName)], {
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
  }
  const client = new Client({ connectionString: adminUrl('5433', dbName) });
  await client.connect();
  try {
    // Les pages sales ne sont pas sur disque : CHECKPOINT avant de lire les fichiers.
    await client.query('CHECKPOINT');
    const { rows } = await client.query<{ path: string }>(
      `SELECT pg_relation_filepath(c.oid) AS path FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'pg_toast') AND c.relkind IN ('r', 't', 'i')`,
    );
    for (const { path } of rows) {
      if (!path) continue;
      const file = await client
        .query<{
          data: Buffer;
        }>('SELECT pg_read_binary_file($1, 0, 134217728, true) AS data', [path])
        .catch(() => ({ rows: [] as Array<{ data: Buffer }> }));
      if (file.rows[0]?.data) parts.push(file.rows[0].data);
    }
  } finally {
    await client.end();
  }
  return Buffer.concat(parts);
}

export interface PurgeRig {
  h: Harness;
  dir: string;
  marker: PurgeMarkerFile;
  gate: PurgeGate;
  keystore: FakeHardwareKeystore;
  quiesced: { count: number };
  service: PurgeService;
  trigger: PurgeTrigger;
  orders: LocalOrdersController;
  manual: ManualPurgeController;
  runtime: PurgeRuntime;
  /** Nouvelle instance sur la MÊME base et le MÊME marqueur : un redémarrage. */
  restart(options?: { production?: boolean }): { service: PurgeService; runtime: PurgeRuntime };
  close(): Promise<void>;
}

export async function makePurgeRig(
  options: {
    hook?: PurgeStepHook;
    production?: boolean;
    centralWait?: { graceMs: number; pollMs: number };
    /** Signal de vidage branché sur la purge manuelle (par défaut aucun : pas de lien). */
    drain?: (h: Harness, keystore: FakeHardwareKeystore) => DrainSignal;
  } = {},
): Promise<PurgeRig> {
  const h = await makeHarness();
  const dir = mkdtempSync(join(tmpdir(), 'gw-purge-'));
  const marker = new PurgeMarkerFile(join(dir, 'purge.marker'));
  const gate = new PurgeGate(marker);
  const keystore = new FakeHardwareKeystore();
  for (const use of ['agreement', 'token', 'batch', 'snapshot'] as const) {
    await keystore.publicKey(use);
  }
  const quiesced = { count: 0 };
  const quiescer: Quiescer = {
    async quiesce() {
      quiesced.count += 1;
    },
  };
  const build = (hook: PurgeStepHook | undefined, production: boolean) => {
    const config = { ...h.config, production } as GatewayConfig;
    const service = new PurgeService(
      config,
      h.tx,
      h.db.pool,
      keystore,
      marker,
      gate,
      quiescer,
      hook,
    );
    const trigger = new PurgeTrigger(h.tx, new DbQueueProbe(h.tx), service);
    const orders = new LocalOrdersController();
    const manual = new ManualPurgeController(
      h.tx,
      h.clock,
      h.authority,
      new DbQueueProbe(h.tx),
      service,
      orders,
      options.drain?.(h, keystore),
      options.centralWait ?? { graceMs: 40, pollMs: 5 },
    );
    const runtime = new PurgeRuntime(marker, service, trigger, manual);
    return { service, trigger, orders, manual, runtime };
  };
  const first = build(options.hook, options.production ?? false);
  return {
    h,
    dir,
    marker,
    gate,
    keystore,
    quiesced,
    ...first,
    restart(opts = {}) {
      const next = build(undefined, opts.production ?? false);
      return { service: next.service, runtime: next.runtime };
    },
    async close() {
      first.trigger.stop();
      await h.close();
    },
  };
}

export async function seedCanary(rig: PurgeRig): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => rig.h.db.pool.query(sql, params);
  const token = randomBytes(32);
  await q(
    `INSERT INTO edge_media (token_hash, media_id, status, pwd_pack_enc)
     VALUES ($1, gen_random_uuid(), 'ACTIVE', $2)`,
    [token, Buffer.from(CANARY)],
  );
  await q(`INSERT INTO edge_pwd_pack_key (key_id, sealed_key) VALUES ('current', $1)`, [
    Buffer.from(CANARY),
  ]);
  await q(
    `INSERT INTO edge_snapshot_entry (version, token_hash, entry, pwd_pack_enc)
     VALUES (1, $1, $2, $3)`,
    [token, JSON.stringify({ pwd: CANARY }), Buffer.from(CANARY)],
  );
  await q(`INSERT INTO edge_token_key (kid, public_jwk, status) VALUES ('k1', $1, 'ACTIVE')`, [
    JSON.stringify({ d: CANARY }),
  ]);
  await q(
    `INSERT INTO edge_device_token_family (fid, device_id, status, refresh_token_sha256_current)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'ACTIVE', $1)`,
    [CANARY_BYTES],
  );
  await q(
    `INSERT INTO edge_vendor (vendor_id, display_name, status)
     VALUES (gen_random_uuid(), 'Buvette', 'ACTIVE')`,
  );
}

export async function closeEvent(rig: PurgeRig): Promise<void> {
  await rig.h.db.pool.query(
    `INSERT INTO edge_event_setting (id, status, currency, minor_units, timezone)
     VALUES (true, 'CLOSED', 'EUR', 2, 'UTC')
     ON CONFLICT (id) DO UPDATE SET status = 'CLOSED'`,
  );
}

export const count = async (rig: PurgeRig, table: string): Promise<number> =>
  Number((await rig.h.db.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

export const readMarker = (rig: PurgeRig): { state: string } | null =>
  existsSync(rig.marker.path) ? JSON.parse(readFileSync(rig.marker.path, 'utf8')) : null;
