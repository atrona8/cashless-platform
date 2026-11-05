// Intégration : blocage immédiat, concurrence, reprise et alarmes du processus snapshot-content
// (WP11).
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
  /** Échec injecté à l'écriture d'un brouillon (null : écriture normale). */
  failWrite: (ledgerId: string) => (Error & { detail?: string }) | null = () => null;
  writes: string[] = [];
  override async writeDraft(
    ...args: Parameters<SnapshotDraftRepository['writeDraft']>
  ): Promise<number> {
    this.writes.push(args[1]);
    const failure = this.failWrite(args[1]);
    if (failure) throw failure;
    return super.writeDraft(...args);
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
const repos = new Map<SnapshotContentWorker, ScopedRepo>();
/** Simule la mort d'une instance : sa connexion se ferme, ses verrous sont libérés. */
const kill = (worker: SnapshotContentWorker): Promise<void> => repos.get(worker)!.close();
const closeAll = async (): Promise<void> => {
  for (const repo of repos.values()) await repo.close();
};

const suspend = async (owner: Pool, f: Fixture, mediaId: string): Promise<void> => {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
    await client.query("UPDATE media SET status = 'SUSPENDED' WHERE id = $1", [mediaId]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
};

const mediaOf = async (owner: Pool, f: Fixture): Promise<string> =>
  (await owner.query('SELECT id FROM media WHERE wallet_id = $1 LIMIT 1', [f.walletId])).rows[0].id;

describe('snapshot-content : blocage, concurrence, reprise (rôle cashless_snapcontent)', () => {
  let owner: Pool;
  let content: Pool;

  beforeAll(() => {
    owner = new Pool({ connectionString: OWNER_URL });
    content = new Pool({ connectionString: SNAPCONTENT_URL });
  });
  // Une connexion de verrous par instance : refermée après chaque test (taille du pool).
  afterEach(async () => {
    await closeAll();
    repos.clear();
  });
  afterAll(async () => {
    await closeAll();
    await owner.end();
    await content.end();
  });

  it('bracelet suspendu : DELTA immédiat, publié en un passage', async () => {
    const f = await createFixture(owner, 10);
    const clock = new Clock(new Date());
    const worker = makeWorker(content, () => [f.ledgerId], clock);
    expect(await worker.runOnce()).toBe(1);
    await publishReady(owner, f);
    await suspend(owner, f, await mediaOf(owner, f));
    clock.advance(1);
    expect(await worker.runOnce()).toBe(1);
    const draft = (await drafts(owner, f)).find((d) => d.status === 'READY')!;
    expect(draft).toMatchObject({ kind: 'DELTA', version: '2', base_version: '1' });
    expect(draft.header).toMatchObject({ entries: 1, removed: 0 });
  });

  it('un FULL lent d’un grand livre ne retarde pas le DELTA bloquant d’un autre', async () => {
    const fast = await createFixture(owner, 10);
    const slow = await createFixture(owner, 2); // aucune version : son premier FULL est lent
    const clock = new Clock(new Date());
    const ledgers = () => [fast.ledgerId];
    const first = makeWorker(content, ledgers, clock);
    expect(await first.runOnce()).toBe(1);
    await kill(first);
    await publishReady(owner, fast);
    class Slow extends RefusingEntryEncryptor {
      override async encrypt(input: Parameters<EntryEncryptor['encrypt']>[0]) {
        if (input.ledgerId === slow.ledgerId) await new Promise((r) => setTimeout(r, 4000));
        return super.encrypt(input);
      }
    }
    const both = () => [fast.ledgerId, slow.ledgerId];
    const worker = makeWorker(
      content,
      both,
      clock,
      { graceMs: 1500, settleAll: false },
      new Slow(),
    );
    await suspend(owner, fast, await mediaOf(owner, fast));
    clock.advance(1);
    const started = Date.now();
    await worker.runOnce();
    expect(Date.now() - started).toBeLessThan(3500);
    expect((await drafts(owner, fast)).filter((d) => d.status === 'READY')).toHaveLength(1);
    expect((await drafts(owner, slow)).filter((d) => d.status === 'READY')).toHaveLength(0);
    for (let i = 0; i < 100; i += 1) {
      if ((await drafts(owner, slow)).some((d) => d.status === 'READY')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const ready = (await drafts(owner, slow)).find((d) => d.status === 'READY')!;
    expect(ready.kind).toBe('FULL');
  }, 30_000);

  it('deux travailleurs, un grand livre : une seule version réservée, aucun échec', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const a = makeWorker(content, () => [f.ledgerId], clock);
    const b = makeWorker(content, () => [f.ledgerId], clock);
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await Promise.all([a.runOnce(), b.runOnce()]);
    silence.mockRestore();
    expect((await drafts(owner, f)).filter((d) => d.status !== 'DISCARDED')).toHaveLength(1);
    expect(Math.max(a.alarm(), b.alarm())).toBe(0);
  });

  it('arrêt avant le scellement : brouillon jeté, jamais READY, puis reprise', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    let fail = true;
    class FlakyTx extends TenantTx {
      override async run<T>(op: string, fn: Parameters<TenantTx['run']>[1]): Promise<T> {
        return super.run(op, (client) =>
          fn({
            query: ((sql: string, params?: unknown[]) => {
              if (fail && String(sql).includes('seal_offline_snapshot_draft'))
                return Promise.reject(new Error('arrêt simulé'));
              return client.query(sql as never, params as never);
            }) as never,
          }),
        ) as Promise<T>;
      }
    }
    const worker = makeWorker(
      content,
      () => [f.ledgerId],
      clock,
      {},
      undefined,
      new FlakyTx(content as never),
    );
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await worker.runOnce()).toBe(0);
    silence.mockRestore();
    const after = await drafts(owner, f);
    expect(after.map((d) => d.status)).toEqual(['DISCARDED']);
    fail = false;
    clock.advance(5); // temporisation après l'échec
    expect(await worker.runOnce()).toBe(1);
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['DISCARDED', 'READY']);
  });

  it('service de clés indisponible : alarme 3', async () => {
    const f = await createFixture(owner, 1);
    const { KmsUnavailableError } = await import('../../../src/kms/kms.ports');
    class Down extends RefusingEntryEncryptor {
      override async encrypt(): Promise<never> {
        throw new KmsUnavailableError('decrypt');
      }
    }
    const worker = makeWorker(content, () => [f.ledgerId], new Clock(new Date()), {}, new Down());
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await worker.runOnce();
    silence.mockRestore();
    expect(worker.alarm()).toBe(3);
  });

  const discardDraft = async (f: Fixture, id: string): Promise<void> => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
      await client.query('SELECT discard_offline_snapshot_draft($1, $2)', [id, 'jeté par le test']);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  };

  it('brouillon READY jeté par le signataire : la version suivante est produite', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const worker = makeWorker(content, () => [f.ledgerId], clock);
    expect(await worker.runOnce()).toBe(1);
    const sealed = (await drafts(owner, f))[0]!;
    await discardDraft(f, sealed.id);
    let produced = 0;
    for (let pass = 0; pass < 12 && produced === 0; pass += 1) {
      clock.advance(120);
      produced = await worker.runOnce();
    }
    expect(produced).toBe(1);
    expect((await drafts(owner, f)).map((d) => [d.version, d.status])).toEqual([
      ['1', 'DISCARDED'],
      ['1', 'READY'],
    ]);
  });

  it('brouillon scellé depuis moins du délai : jamais jeté, puis jeté s’il n’est pas signé', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const worker = makeWorker(content, () => [f.ledgerId], clock);
    expect(await worker.runOnce()).toBe(1);
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    clock.advance(9 * 60 + 59);
    expect(await worker.runOnce()).toBe(0);
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['READY']);
    clock.advance(2); // 10 min 01 s
    expect(await worker.runOnce()).toBe(1);
    silence.mockRestore();
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['DISCARDED', 'READY']);
    expect(worker.alarm()).toBe(2); // le signataire ne signe pas
  });

  it('démarrage : le brouillon laissé par un processus précédent est jeté', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const previous = makeWorker(content, () => [f.ledgerId], clock);
    expect(await previous.runOnce()).toBe(1);
    await kill(previous);
    const restarted = makeWorker(content, () => [f.ledgerId], clock);
    expect(await restarted.runOnce()).toBe(1);
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['DISCARDED', 'READY']);
  });

  it('échec du jet d’un brouillon après échec d’écriture : signalé, jamais avalé', async () => {
    const f = await createFixture(owner, 3);
    class DeadTx extends TenantTx {
      override async run<T>(op: string, fn: Parameters<TenantTx['run']>[1]): Promise<T> {
        return super.run(op, (client) =>
          fn({
            query: ((sql: string, params?: unknown[]) => {
              const text = String(sql);
              if (text.includes('seal_offline_snapshot_draft'))
                return Promise.reject(new Error('arrêt simulé'));
              if (text.includes('discard_offline_snapshot_draft'))
                return Promise.reject(new Error('coupure base simulée'));
              return client.query(sql as never, params as never);
            }) as never,
          }),
        ) as Promise<T>;
      }
    }
    const worker = makeWorker(
      content,
      () => [f.ledgerId],
      new Clock(new Date()),
      {},
      undefined,
      new DeadTx(content as never),
    );
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await worker.runOnce();
    const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
    spy.mockRestore();
    expect(logged).toMatch(/jet du brouillon \d+ échoué/);
    expect(logged).toMatch(/coupure base simulée/);
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['OPEN']);
  });

  it('plafond max_snapshot_age de 5 min : valid_until et maintien à un tiers du plafond', async () => {
    const f = await createFixture(owner, 3);
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
      await client.query(
        "UPDATE offline_policy SET max_snapshot_age = interval '5 minutes' WHERE scope_id = $1",
        [f.eventId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const clock = new Clock(new Date());
    const worker = makeWorker(content, () => [f.ledgerId], clock);
    expect(await worker.runOnce()).toBe(1);
    const header = (await drafts(owner, f))[0]!.header as {
      generated_at: string;
      valid_until: string;
    };
    expect(Date.parse(header.valid_until) - Date.parse(header.generated_at)).toBe(300_000);
    expect(await publishReady(owner, f)).toBe(1);
    clock.advance(99);
    expect(await worker.runOnce()).toBe(0);
    clock.advance(2);
    expect(await worker.runOnce()).toBe(1);
  });

  it('désaccord de version : réessai silencieux, signalé s’il persiste', async () => {
    const f = await createFixture(owner, 3);
    const worker = makeWorker(content, () => [f.ledgerId], new Clock(new Date()));
    repos.get(worker)!.failWrite = () =>
      Object.assign(new Error('version attendue périmée'), { detail: 'OWNED_FIELD_MISMATCH' });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await worker.runOnce();
    await worker.runOnce();
    expect(spy).not.toHaveBeenCalled();
    expect(worker.alarm()).toBe(0);
    await worker.runOnce();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain('version attendue périmée');
    spy.mockRestore();
    expect(worker.alarm()).toBe(2);
  });

  it('purge du contenu : appelée une fois par FULL publié, pour ce grand livre', async () => {
    const f = await createFixture(owner, 3);
    const purge = jest.spyOn(SnapshotDraftRepository.prototype, 'purge');
    try {
      const clock = new Clock(new Date());
      const worker = makeWorker(content, () => [f.ledgerId], clock);
      const mine = () => purge.mock.calls.filter((call) => call[1] === f.ledgerId).length;
      expect(await worker.runOnce()).toBe(1);
      expect(mine()).toBe(0); // aucun FULL publié
      await publishReady(owner, f);
      clock.advance(1);
      await worker.runOnce();
      expect(mine()).toBe(1);
      expect(purge).toHaveBeenCalledWith(f.operatorId, f.ledgerId);
      clock.advance(1);
      await worker.runOnce();
      expect(mine()).toBe(1);
    } finally {
      purge.mockRestore();
    }
  });

  const setAge = async (f: Fixture, age: string): Promise<void> => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
      await client.query(
        'UPDATE offline_policy SET max_snapshot_age = $2::interval WHERE scope_id = $1',
        [f.eventId, age],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  };
  const span = async (f: Fixture): Promise<number> => {
    const header = (await drafts(owner, f))[0]!.header as {
      generated_at: string;
      valid_until: string;
    };
    return Date.parse(header.valid_until) - Date.parse(header.generated_at);
  };

  it('plafond en heures et en jours : valid_until suit l’interval, maintien au tiers', async () => {
    const hours = await createFixture(owner, 3);
    await setAge(hours, '2 hours');
    const clock = new Clock(new Date());
    const worker = makeWorker(content, () => [hours.ledgerId], clock);
    expect(await worker.runOnce()).toBe(1);
    expect(await span(hours)).toBe(7_200_000);
    await publishReady(owner, hours);
    clock.advance(39 * 60 + 59); // 39 min 59 s : tiers de 2 h non atteint
    expect(await worker.runOnce()).toBe(0);
    clock.advance(2);
    expect(await worker.runOnce()).toBe(1);
    const days = await createFixture(owner, 3);
    await setAge(days, '3 days');
    expect(await makeWorker(content, () => [days.ledgerId], new Clock(new Date())).runOnce()).toBe(
      1,
    );
    expect(await span(days)).toBe(259_200_000);
  });

  const lastDraftIds = async (f: Fixture): Promise<string[]> =>
    (await drafts(owner, f)).map((d) => `${d.id}:${d.status}`);

  it('deux instances, signataire muet : l’autre n’y touche pas, un jet par délai', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const a = makeWorker(content, () => [f.ledgerId], clock);
    const b = makeWorker(content, () => [f.ledgerId], clock);
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await a.runOnce()).toBe(1);
    const firstSeen = new Map<string, number>();
    const discardedAt = new Map<string, number>();
    const observe = async (): Promise<void> => {
      for (const d of await drafts(owner, f)) {
        if (!firstSeen.has(d.id)) firstSeen.set(d.id, clock.current.getTime());
        if (d.status === 'DISCARDED' && !discardedAt.has(d.id))
          discardedAt.set(d.id, clock.current.getTime());
      }
    };
    await observe();
    for (let pass = 0; pass < 50; pass += 1) {
      clock.advance(30);
      await b.runOnce(); // l'autre instance, démarrée après la première
      await a.runOnce();
      await observe();
    }
    silence.mockRestore();
    expect(repos.get(b)!.writes).toEqual([]);
    expect(b.alarm()).toBe(0);
    expect(discardedAt.size).toBeGreaterThanOrEqual(1);
    expect(discardedAt.size).toBeLessThanOrEqual(3); // 25 min : un jet par tranche de 10 min
    for (const [id, at] of discardedAt) expect(at - firstSeen.get(id)!).toBeGreaterThan(600_000);
    expect((await lastDraftIds(f)).length).toBeLessThanOrEqual(4);
  }, 60_000);

  it('deux instances, signataire lent de 2 min : aucun jet, aucune alarme', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const a = makeWorker(content, () => [f.ledgerId], clock);
    const b = makeWorker(content, () => [f.ledgerId], clock);
    expect(await a.runOnce()).toBe(1);
    for (let pass = 0; pass < 4; pass += 1) {
      clock.advance(30);
      await b.runOnce();
      await a.runOnce();
    }
    await publishReady(owner, f); // 2 min après la réservation
    clock.advance(30);
    await b.runOnce();
    await a.runOnce();
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['PUBLISHED']);
    expect(Math.max(a.alarm(), b.alarm())).toBe(0);
    expect(repos.get(b)!.writes).toEqual([]);
  });

  it('une instance qui meurt libère le grand livre : la suivante jette l’orphelin', async () => {
    const f = await createFixture(owner, 3);
    const clock = new Clock(new Date());
    const a = makeWorker(content, () => [f.ledgerId], clock);
    const b = makeWorker(content, () => [f.ledgerId], clock);
    expect(await a.runOnce()).toBe(1);
    expect(await b.runOnce()).toBe(0); // A vit : B n'y touche pas
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['READY']);
    await kill(a);
    expect(await b.runOnce()).toBe(1);
    expect((await drafts(owner, f)).map((d) => d.status)).toEqual(['DISCARDED', 'READY']);
  });

  describe('temporisation après échec', () => {
    const boom = (): Error => new Error('échec simulé');
    let silence: jest.SpyInstance;
    beforeEach(() => {
      silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => silence.mockRestore());

    const attempts = (worker: SnapshotContentWorker, f: Fixture): number =>
      repos.get(worker)!.writes.filter((id) => id === f.ledgerId).length;

    it('croissance exponentielle de 1 s, plafond de 5 min', async () => {
      const f = await createFixture(owner, 3);
      const clock = new Clock(new Date());
      const worker = makeWorker(content, () => [f.ledgerId], clock);
      repos.get(worker)!.failWrite = boom;
      await worker.runOnce();
      const waits = [1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300, 300];
      for (const [index, wait] of waits.entries()) {
        expect(attempts(worker, f)).toBe(index + 1);
        clock.advance(wait - 0.1);
        await worker.runOnce();
        expect(attempts(worker, f)).toBe(index + 1);
        clock.advance(0.2);
        await worker.runOnce();
        expect(attempts(worker, f)).toBe(index + 2);
      }
    }, 60_000);

    it('indépendance entre grands livres : un échec ne retarde pas l’autre', async () => {
      const bad = await createFixture(owner, 3);
      const good = await createFixture(owner, 10);
      const clock = new Clock(new Date());
      const worker = makeWorker(content, () => [bad.ledgerId, good.ledgerId], clock);
      repos.get(worker)!.failWrite = (ledger) => (ledger === bad.ledgerId ? boom() : null);
      await worker.runOnce();
      await publishReady(owner, good);
      clock.advance(1.1);
      await worker.runOnce();
      clock.advance(2.1);
      await worker.runOnce();
      expect(attempts(worker, bad)).toBe(3); // prochain essai dans 4 s
      await suspend(owner, good, await mediaOf(owner, good));
      clock.advance(1);
      await worker.runOnce();
      expect(attempts(worker, bad)).toBe(3);
      expect(attempts(worker, good)).toBe(2);
      expect((await drafts(owner, good)).map((d) => d.kind)).toEqual(['FULL', 'DELTA']);
    });

    it('remise à zéro après un succès : l’échec suivant attend de nouveau 1 s', async () => {
      const f = await createFixture(owner, 3);
      const clock = new Clock(new Date());
      const worker = makeWorker(content, () => [f.ledgerId], clock);
      const repo = repos.get(worker)!;
      repo.failWrite = boom;
      await worker.runOnce(); // échec 1 (attente 1 s)
      clock.advance(1.1);
      await worker.runOnce(); // échec 2 (attente 2 s)
      repo.failWrite = () => null;
      clock.advance(2.1);
      expect(await worker.runOnce()).toBe(1); // succès : compteur remis à zéro
      await publishReady(owner, f);
      await suspend(owner, f, await mediaOf(owner, f));
      repo.failWrite = boom;
      clock.advance(1);
      await worker.runOnce(); // échec 1 de nouveau (et non 3)
      const before = attempts(worker, f);
      clock.advance(0.9);
      await worker.runOnce();
      expect(attempts(worker, f)).toBe(before);
      clock.advance(0.2);
      await worker.runOnce();
      expect(attempts(worker, f)).toBe(before + 1);
    });
  });
});
