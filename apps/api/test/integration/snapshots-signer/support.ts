// Aides communes des suites du signataire (WP13). Tout est posé par le PROPRIÉTAIRE (la base de lot) ; le processus
// testé, lui, tourne sous `cashless_snapsign`. Chaque test crée son propre grand livre : les versions ne se mêlent pas.
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { TenantTx } from '../../../src/db/tenant-tx';
import { FakeKms } from '../../../src/kms/fake-kms';
import { WorkerRegistry } from '../../../src/processes/worker';
import { contentSha256 } from '../../../src/snapshots-signer/draft-verifier';
import { SeqGapAgeWorker } from '../../../src/snapshots-signer/seq-gap-age.worker';
import { SnapshotSignerRepository } from '../../../src/snapshots-signer/snapshot-signer.repository';
import { SnapshotSignerWorker } from '../../../src/snapshots-signer/snapshot-signer.worker';
import { OWNER_URL } from '../../support/db';

// Isolation (batterie complète en parallèle, base partagée) : chaque test crée SON prestataire, SA clé de signature
// (clé propre du prestataire, choisie avant celle de la plateforme) et SON grand livre ; le processus testé ne voit
// que les brouillons, trous et RETRY de ces objets (dépôt « borné » ci-dessous), jamais ceux d'une autre suite.
const OWN_LEDGERS = new Set<string>();
const OWN_DEVICES = new Set<string>();
const JURISDICTION = '00000000-0000-0000-0000-0000000c0013';

/** Rôle du processus, sur la même base que le propriétaire. */
export const SNAPSIGN_URL =
  process.env.DATABASE_URL_SNAPSIGN ||
  OWNER_URL.replace(
    /^postgres:\/\/[^@]*@/,
    `postgres://cashless_snapsign:${process.env.CASHLESS_SNAPSIGN_PASSWORD || 'cashless_snapsign_local'}@`,
  );

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

export interface TestEntry {
  token: string;
  spendable?: number;
}

export const entryOf = (token: string, spendable = 1000) => ({
  batch_event_id: null,
  batch_status: 'ACTIVE',
  key_index: 1,
  last_counter: null,
  nfc_uid: '04440000000001',
  originality_sig_sha256: sha(`sig-${token}`),
  pwd_pack_sha256: null,
  spendable,
  status: 'ACTIVE',
  token_hash: token,
  wallet_status: 'ACTIVE',
});

export async function inOperator<T>(
  owner: Pool,
  operatorId: string,
  fn: (query: Pool['query']) => Promise<T>,
): Promise<T> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
    const result = await fn(client.query.bind(client) as Pool['query']);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Données communes et idempotentes : partie plateforme et profil de juridiction. */
export async function seedOperators(owner: Pool): Promise<void> {
  await owner
    .query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
        WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
    )
    .catch(() => undefined);
  await owner.query(
    `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
     VALUES ($1, 'SN', 130013, '2026-01-01', 'ORGANIZER') ON CONFLICT DO NOTHING`,
    [JURISDICTION],
  );
}

export interface World {
  operatorId: string;
  eventId: string;
  ledgerId: string;
  /** Identifiant de la clé de signature ACTIVE propre au prestataire (si `ref` fourni). */
  keyId: string | null;
}

/** Prestataire, événement et grand livre neufs ; avec `ref`, une clé de signature ACTIVE propre au prestataire. */
export async function newWorld(owner: Pool, kms?: FakeKms, ref?: string): Promise<World> {
  const operatorId = randomUUID();
  const organizerId = randomUUID();
  const eventId = randomUUID();
  const ledgerId = randomUUID();
  await owner.query(
    `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Prestataire WP13', 'SN')`,
    [operatorId],
  );
  await owner.query(
    `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur WP13')`,
    [organizerId, operatorId],
  );
  await owner.query(
    `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                        funds_holder, status)
     VALUES ($1, $2, $3, 'Événement WP13', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', 'LIVE')`,
    [eventId, operatorId, organizerId, JURISDICTION],
  );
  await owner.query(
    `INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
     VALUES ($1, $2, 'EVENT', $3, 'XOF', $4, $4)`,
    [ledgerId, operatorId, eventId, organizerId],
  );
  OWN_LEDGERS.add(ledgerId);
  const world: World = { operatorId, eventId, ledgerId, keyId: null };
  if (kms && ref) world.keyId = await activateKey(owner, kms, ref, operatorId);
  return world;
}

/** Plus aucune clé valide propre au prestataire du test (celles des autres suites ne sont pas touchées). */
export async function revokeKeys(owner: Pool, operatorId: string): Promise<void> {
  await owner.query(
    `UPDATE snapshot_signing_key SET status = 'REVOKED'
      WHERE owner = 'CENTRAL' AND operator_id = $1 AND status IN ('ACTIVE','RETIRED')`,
    [operatorId],
  );
}

/** Clé centrale ACTIVE du prestataire, dont la clé publique est celle du faux pour `ref`. Rend le `key_id`. */
export async function activateKey(
  owner: Pool,
  kms: FakeKms,
  ref: string,
  operatorId: string,
): Promise<string> {
  await revokeKeys(owner, operatorId);
  const keyId = `k13-${randomUUID().slice(0, 8)}`;
  await owner.query(
    `INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
     VALUES ($1, $2, 'CENTRAL', 'ECDSA_P256_SHA256', $3, $4, 'ACTIVE')`,
    [keyId, operatorId, await kms.publicKey(ref), ref],
  );
  return keyId;
}

export interface DraftOptions {
  kind?: 'FULL' | 'DELTA';
  live?: TestEntry[];
  removed?: string[];
  seal?: boolean;
  /** Surcharge de l'en-tête fourni au producteur (empreinte comprise). */
  header?: Record<string, unknown>;
  generatedAt?: Date;
}

/** Brouillon posé par les fonctions SQL du producteur (WP03), empreinte calculée comme le fera WP11. */
export async function seedDraft(
  owner: Pool,
  world: World,
  options: DraftOptions = {},
): Promise<bigint> {
  const kind = options.kind ?? 'FULL';
  const live = (options.live ?? [{ token: sha('a') }, { token: sha('b') }]).slice();
  const removed = (options.removed ?? []).slice().sort();
  live.sort((x, y) => (x.token < y.token ? -1 : 1));
  const entries = live.map((e) => entryOf(e.token, e.spendable));
  const generated = options.generatedAt ?? new Date();
  const header = {
    kind,
    generated_at: generated.toISOString().replace(/\.\d+Z$/, 'Z'),
    valid_until: new Date(generated.getTime() + 15 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    entries: entries.length,
    removed: removed.length,
    content_sha256: contentSha256(entries, removed),
    ...options.header,
  };
  const items = [
    ...entries.map((entry) => ({
      token_hash: entry.token_hash,
      entry,
      pwd_pack_enc: null,
      removed: false,
    })),
    ...removed.map((token) => ({
      token_hash: token,
      entry: null,
      pwd_pack_enc: null,
      removed: true,
    })),
  ];
  return inOperator(owner, world.operatorId, async (query) => {
    const saved = await query<{ id: string }>(
      `SELECT save_offline_snapshot_draft($1::uuid, $2, $3::jsonb, '\\x0102'::bytea, $4::jsonb) AS id`,
      [world.ledgerId, kind, JSON.stringify(header), JSON.stringify(items)],
    );
    const id = BigInt(saved.rows[0]!.id);
    if (options.seal !== false)
      await query('SELECT seal_offline_snapshot_draft($1::bigint)', [id.toString()]);
    return id;
  });
}

/** Jette les brouillons en cours des grands livres de CE fichier (jamais ceux d'une autre suite). */
export async function clearDrafts(owner: Pool): Promise<void> {
  const ledgers = [...OWN_LEDGERS];
  if (ledgers.length === 0) return;
  await owner.query(
    `DELETE FROM offline_snapshot_entry
      WHERE draft_id IN (SELECT id FROM offline_snapshot_draft
                          WHERE ledger_id = ANY($1::uuid[]) AND status IN ('OPEN','READY'))`,
    [ledgers],
  );
  await owner.query(
    `UPDATE offline_snapshot_draft SET status = 'DISCARDED', discard_reason = 'test'
      WHERE ledger_id = ANY($1::uuid[]) AND status IN ('OPEN','READY')`,
    [ledgers],
  );
}

export const draftStatus = async (owner: Pool, id: bigint): Promise<string> =>
  (await owner.query('SELECT status FROM offline_snapshot_draft WHERE id = $1', [id.toString()]))
    .rows[0].status;

export const publishedVersions = async (owner: Pool, ledgerId: string) =>
  (
    await owner.query(
      'SELECT version::int AS version, kind, key_id, header, signature FROM offline_snapshot WHERE ledger_id = $1 ORDER BY version',
      [ledgerId],
    )
  ).rows;

export interface Harness {
  pool: Pool;
  kms: FakeKms;
  repository: SnapshotSignerRepository;
  signer: SnapshotSignerWorker;
  gaps: SeqGapAgeWorker;
  close(): Promise<void>;
}

/** Même dépôt, borné aux grands livres et terminaux créés par les tests de CE fichier. */
class ScopedRepository extends SnapshotSignerRepository {
  override async readyDrafts() {
    return (await super.readyDrafts()).filter((draft) => OWN_LEDGERS.has(draft.ledgerId));
  }
  override async seqGapsToAlert() {
    return (await super.seqGapsToAlert()).filter((a) => a.deviceId && OWN_DEVICES.has(a.deviceId));
  }
  override async retriesToAlert() {
    return (await super.retriesToAlert()).filter((a) => OWN_DEVICES.has(a.deviceId));
  }
}

/** Le processus sans Nest : mêmes classes, pool du rôle `cashless_snapsign`, faux service de clés. */
export function harness(keyRef: string, kms = new FakeKms()): Harness {
  const pool = new Pool({ connectionString: SNAPSIGN_URL, max: 4 });
  const repository = new ScopedRepository(new TenantTx(pool as never));
  const registry = new WorkerRegistry();
  const config = { snapshotSigningKeyRef: keyRef } as never;
  return {
    pool,
    kms,
    repository,
    signer: new SnapshotSignerWorker(registry, repository, kms, config, {
      graceMs: 1500,
      settleAll: true,
    }),
    gaps: new SeqGapAgeWorker(registry, repository),
    close: () => pool.end(),
  };
}

/** Terminal, trou de numérotation (SEQ_GAP) ouvert depuis `ageHours` heures. */
export async function seedGap(owner: Pool, world: World, seq: number, ageHours: number) {
  const deviceId = randomUUID();
  OWN_DEVICES.add(deviceId);
  const anomalyId = randomUUID();
  await owner.query(
    `INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES ($1, $2, 'POS', $3, $4)`,
    [deviceId, world.operatorId, world.eventId, `W13-${deviceId.slice(0, 8)}`],
  );
  await owner.query(
    `INSERT INTO anomaly (id, operator_id, ledger_id, kind, device_id, seq, amount, created_at)
     VALUES ($1, $2, $3, 'SEQ_GAP', $4, $5, 0, clock_timestamp() - make_interval(hours => $6))`,
    [anomalyId, world.operatorId, world.ledgerId, deviceId, seq, ageHours],
  );
  return { deviceId, anomalyId };
}

/** Lot hors ligne de trois opérations et numéro RETRY ouvert depuis `ageHours` heures. */
export async function seedRetry(owner: Pool, world: World, ageHours: number) {
  const deviceId = randomUUID();
  OWN_DEVICES.add(deviceId);
  const batchId = randomUUID();
  await owner.query(
    `INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES ($1, $2, 'POS', $3, $4)`,
    [deviceId, world.operatorId, world.eventId, `W13-${deviceId.slice(0, 8)}`],
  );
  await inOperator(owner, world.operatorId, async (query) => {
    await query(`DO $$ DECLARE hs bytea[]; e bytea; h bytea; BEGIN
      SELECT array_agg(sha256(convert_to('op' || s, 'UTF8')) ORDER BY s) INTO hs FROM generate_series(1, 3) s;
      e := device_chain_genesis('${deviceId}'::uuid);
      FOREACH h IN ARRAY hs LOOP e := chain_step(e, h); END LOOP;
      PERFORM open_offline_batch('${batchId}'::uuid, '${deviceId}'::uuid, '${world.ledgerId}'::uuid, 1,
                                 device_chain_genesis('${deviceId}'::uuid), hs, e, '\\x01');
    END $$`);
    await query(
      `INSERT INTO offline_batch_retry (batch_id, seq, operator_id, device_id, reason, created_at)
       VALUES ($1, 1, $2, $3, 'INSUFFICIENT_FUNDS_RETRY', clock_timestamp() - make_interval(hours => $4))`,
      [batchId, world.operatorId, deviceId, ageHours],
    );
  });
  return { deviceId, batchId };
}
