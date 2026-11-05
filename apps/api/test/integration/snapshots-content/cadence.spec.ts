// Intégration : cadence du processus snapshot-content (WP11, T046/T047), base de lot, rôle
// cashless_snapcontent.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdvisorySession } from '../../../src/db/advisory-session';
import { TenantTx } from '../../../src/db/tenant-tx';
import { WorkerRegistry } from '../../../src/processes/worker';
import {
  RefusingEntryEncryptor,
  type EntryEncryptor,
} from '../../../src/snapshots-content/entry-encryptor';
import {
  SnapshotContentWorker,
  type SnapshotContentOptions,
} from '../../../src/snapshots-content/snapshot-content.worker';
import {
  SnapshotDraftRepository,
  type Target,
} from '../../../src/snapshots-content/snapshot-draft.repository';
import { OWNER_URL } from '../../support/db';

// --- Support commun (copié dans les deux suites : seuls les fichiers du lot sont écrits)
// -------------------
const env = process.env;
const SNAPCONTENT_URL =
  env.DATABASE_URL_SNAPCONTENT ||
  'postgres://cashless_snapcontent:' +
    `${env.CASHLESS_SNAPCONTENT_PASSWORD || 'cashless_snapcontent_local'}` +
    `@${env.PGHOST || '127.0.0.1'}:${env.PGPORT || '5433'}/${env.PGDATABASE || 'cashless_test'}`;

interface Fixture {
  operatorId: string;
  ledgerId: string;
  eventId: string;
  walletId: string;
  batchId: string;
  keyId: string;
}

const uid = (): string => randomUUID();

/** Prestataire, événement LIVE, grand livre, un terminal éligible, une clé de signature, un
 * portefeuille. */
async function createFixture(owner: Pool, bracelets: number): Promise<Fixture> {
  const f: Fixture = {
    operatorId: uid(),
    ledgerId: '',
    eventId: uid(),
    walletId: uid(),
    batchId: uid(),
    keyId: `k-${uid()}`,
  };
  const organizer = uid();
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
        WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
    );
    await client.query(
      `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR',
        'Prestataire WP11', 'SN')`,
      [f.operatorId],
    );
    await client.query(
      `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Org
        WP11')`,
      [organizer, f.operatorId],
    );
    const jurisdiction = uid();
    await client.query(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from,
        breakage_destination)
       VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
      [jurisdiction, Math.floor(Math.random() * 1e9)],
    );
    await client.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                          funds_holder, status)
       VALUES ($1, $2, $3, 'Evt WP11', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', 'LIVE')`,
      [f.eventId, f.operatorId, organizer, jurisdiction],
    );
    await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
    await client.query('SELECT open_event_ledger($1)', [f.eventId]);
    f.ledgerId = (
      await client.query('SELECT id FROM ledger WHERE scope_id = $1', [f.eventId])
    ).rows[0].id;
    await client.query(
      `INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key)
       VALUES ($1, $2, 'POS', 'CATALOG_POS', $3, $4, decode(repeat('04', 65), 'hex'))`,
      [uid(), f.operatorId, f.eventId, `S-${uid()}`],
    );
    await client.query(
      `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale,
                                   max_per_media_per_device, max_total_per_device)
       VALUES ($1, 'EVENT', $2, true, 5000, 10000, 100000)`,
      [f.operatorId, f.eventId],
    );
    await client.query(
      `INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key,
        kms_key_ref, status)
       VALUES ($1, $2, 'CENTRAL', 'ECDSA_P256_SHA256', '\\x01', $3, 'ACTIVE')`,
      [f.keyId, f.operatorId, `test:${f.keyId}`],
    );
    await client.query(
      `INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [f.walletId, f.operatorId, f.ledgerId],
    );
    await client.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES ($1, 1, $2,
        'ACTIVE')`,
      [f.operatorId, `test:hmac-${f.operatorId}`],
    );
    await client.query(
      `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity,
        key_index, status)
       VALUES ($1, $2, $3, $4, 'PUBLIC', 99, 1, 'ACTIVE')`,
      [f.batchId, f.operatorId, organizer, f.eventId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await addBracelets(owner, f, bracelets);
  return f;
}

/** Ajoute n bracelets ACTIFS (sans mot de passe) au portefeuille ; rend leurs identifiants. */
async function addBracelets(
  owner: Pool,
  f: Fixture,
  n: number,
  assignedAt: Date | null = null,
): Promise<string[]> {
  const ids: string[] = [];
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
    for (let i = 0; i < n; i += 1) {
      const id = uid();
      ids.push(id);
      await client.query(
        `INSERT INTO media (id, operator_id, kind, token_hash, batch_id, key_index, wallet_id,
          status)
         VALUES ($1::uuid, $2, 'NFC_TAG', sha256(convert_to($1::text, 'UTF8')), $3, 1, $4,
           'ACTIVE')`,
        [id, f.operatorId, f.batchId, f.walletId],
      );
    }
    // L'horloge du test peut avancer au-delà de celle de la base : les dates de changement suivent
    // la sienne.
    if (assignedAt)
      await client.query(
        'UPDATE media_assignment SET assigned_at = $1 WHERE media_id = ANY($2::uuid[])',
        [assignedAt, ids],
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return ids;
}

interface DraftRow {
  id: string;
  kind: string;
  version: string;
  base_version: string | null;
  status: string;
  header: Record<string, unknown>;
}

async function drafts(owner: Pool, f: Fixture): Promise<DraftRow[]> {
  return (
    await owner.query(
      'SELECT id, kind, version, base_version, status, header FROM offline_snapshot_draft ' +
        'WHERE ledger_id = $1 ORDER BY version, id',
      [f.ledgerId],
    )
  ).rows;
}

/** Joue le signataire : publie le brouillon READY (la base ne vérifie pas la signature). */
async function publishReady(owner: Pool, f: Fixture): Promise<number> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
    const { rows } = await client.query(
      "SELECT id FROM offline_snapshot_draft WHERE ledger_id = $1 AND status = 'READY'",
      [f.ledgerId],
    );
    const { rows: out } = await client.query(
      "SELECT version FROM publish_offline_snapshot($1, $2, '\\x3045'::bytea)",
      [rows[0].id, f.keyId],
    );
    await client.query('COMMIT');
    return Number(out[0].version);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

class Clock {
  constructor(public current: Date) {}
  now = (): Date => new Date(this.current.getTime());
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/** Dépôt limité aux grands livres du test (la base de lot peut en contenir d'autres). */
class ScopedRepo extends SnapshotDraftRepository {
  constructor(
    tx: TenantTx,
    private readonly ledgers: () => string[],
    locks?: AdvisorySession,
  ) {
    super(tx, locks);
  }
  override async targets(): Promise<Target[]> {
    return (await super.targets()).filter((t) => this.ledgers().includes(t.ledgerId));
  }
}

function makeWorker(
  pool: Pool,
  ledgers: () => string[],
  clock: Clock,
  extra: Partial<SnapshotContentOptions> = {},
  encryptor: EntryEncryptor = new RefusingEntryEncryptor(),
  tx: TenantTx = new TenantTx(pool as never),
): SnapshotContentWorker {
  const repo = new ScopedRepo(tx, ledgers, new AdvisorySession(pool as never));
  const worker = new SnapshotContentWorker(new WorkerRegistry(), repo, encryptor, {
    now: clock.now,
    fullEveryMs: 3_600_000,
    orphanDelayMs: 600_000,
    graceMs: 5000,
    settleAll: true,
    ...extra,
  });
  repos.set(worker, repo);
  return worker;
}

/** Dépôts ouverts par les tests : leur connexion de verrous est fermée en fin de suite. */
const repos = new Map<SnapshotContentWorker, SnapshotDraftRepository>();
const closeAll = async (): Promise<void> => {
  for (const repo of repos.values()) await repo.close();
};

describe('snapshot-content : cadence (rôle cashless_snapcontent)', () => {
  let owner: Pool;
  let content: Pool;
  let f: Fixture;
  let clock: Clock;
  let worker: SnapshotContentWorker;

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL });
    content = new Pool({ connectionString: SNAPCONTENT_URL });
    f = await createFixture(owner, 10);
  });
  afterAll(async () => {
    await closeAll();
    await owner.end();
    await content.end();
  });
  beforeAll(() => {
    clock = new Clock(new Date());
    worker = makeWorker(content, () => [f.ledgerId], clock);
  });

  it('première version : FULL scellé (READY) en un passage, en-tête complet', async () => {
    expect(await worker.runOnce()).toBe(1);
    const all = await drafts(owner, f);
    const draft = all[0]!;
    const others = all.slice(1);
    expect(others).toEqual([]);
    expect(draft).toMatchObject({ kind: 'FULL', version: '1', status: 'READY' });
    expect(draft.header).toMatchObject({
      format: 'CASHLESS-SNAPSHOT/v1',
      ledger_id: f.ledgerId,
      event_id: f.eventId,
      operator_id: f.operatorId,
      currency: 'XOF',
      key_id: f.keyId,
      version: 1,
      base_version: null,
      entries: 10,
      removed: 0,
    });
    expect(draft.header.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Tant que le brouillon n'est pas publié, un autre passage n'en réserve pas un second.
    expect(await worker.runOnce()).toBe(0);
    expect(await publishReady(owner, f)).toBe(1);
  });

  it('aucun brouillon à 299 s, version de maintien (DELTA vide) à 301 s', async () => {
    clock.advance(299);
    expect(await worker.runOnce()).toBe(0);
    clock.advance(2);
    expect(await worker.runOnce()).toBe(1);
    const draft = (await drafts(owner, f)).find((d) => d.status === 'READY')!;
    expect(draft).toMatchObject({ kind: 'DELTA', version: '2', base_version: '1' });
    expect(draft.header).toMatchObject({ entries: 0, removed: 0 });
    expect(await publishReady(owner, f)).toBe(2);
  });

  it('changement ordinaire (nouveau bracelet) : pas de DELTA à 59 s, DELTA à 61 s', async () => {
    await addBracelets(owner, f, 1, clock.now());
    clock.advance(59);
    expect(await worker.runOnce()).toBe(0);
    clock.advance(2);
    expect(await worker.runOnce()).toBe(1);
    const draft = (await drafts(owner, f)).find((d) => d.status === 'READY')!;
    expect(draft).toMatchObject({ kind: 'DELTA', version: '3', base_version: '2' });
    expect(draft.header).toMatchObject({ entries: 1, removed: 0 });
    expect(await publishReady(owner, f)).toBe(3);
  });

  it('DELTA de plus de 20 % des entrées : FULL', async () => {
    await addBracelets(owner, f, 4, clock.now()); // 4 sur 11 > 20 %
    clock.advance(61);
    expect(await worker.runOnce()).toBe(1);
    const draft = (await drafts(owner, f)).find((d) => d.status === 'READY')!;
    expect(draft).toMatchObject({ kind: 'FULL', version: '4', base_version: null });
    expect(draft.header).toMatchObject({ entries: 15 });
    expect(await publishReady(owner, f)).toBe(4);
  });

  it('FULL horaire (horloge injectée) : à 3 601 s depuis le dernier FULL', async () => {
    clock.advance(3000);
    expect(await worker.runOnce()).toBe(1); // maintien (DELTA vide)
    await publishReady(owner, f);
    clock.advance(601);
    expect(await worker.runOnce()).toBe(1);
    const draft = (await drafts(owner, f)).find((d) => d.status === 'READY')!;
    expect(draft.kind).toBe('FULL');
    await publishReady(owner, f);
  });

  it('--list décrit la prochaine version due sans rien écrire', async () => {
    const before = (await drafts(owner, f)).length;
    const lines = await worker.describe();
    expect(lines.join('\n')).toContain(f.ledgerId);
    expect((await drafts(owner, f)).length).toBe(before);
  });

  it('le rôle n’a aucun droit sur offline_snapshot ni sur le contenu des brouillons', async () => {
    const client = await content.connect();
    try {
      await client.query("SELECT set_config('app.operator_id', $1, false)", [f.operatorId]);
      for (const table of ['offline_snapshot', 'offline_snapshot_draft', 'offline_snapshot_entry'])
        await expect(client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      await expect(
        client.query(`INSERT INTO offline_snapshot_state (ledger_id) VALUES ('${f.ledgerId}')`),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });

  it('mot de passe : rien d’écrit, alarme 2 au troisième échec de suite', async () => {
    const g = await createFixture(owner, 1);
    const dek = uid();
    await owner.query(
      `INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref,
        encrypted_dek)
       VALUES ($1, $2, 1, 1, 'test:wrap', '\\x01')`,
      [dek, g.operatorId],
    );
    await owner.query(
      `UPDATE media SET pwd_pack_enc = decode(repeat('aa', 34), 'hex'), pwd_pack_dek_id = $2
        WHERE wallet_id = $1`,
      [g.walletId, dek],
    );
    const otherClock = new Clock(new Date());
    const other = makeWorker(content, () => [g.ledgerId], otherClock);
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let pass = 1; pass <= 3; pass += 1) {
      otherClock.advance(400); // au-delà de la temporisation entre deux essais
      expect(await other.runOnce()).toBe(0);
      expect(other.alarm()).toBe(pass < 3 ? 0 : 2);
    }
    silence.mockRestore();
    expect(await drafts(owner, g)).toEqual([]);
  });
});
