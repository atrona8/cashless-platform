// Jeu d'essai de bout en bout de la mission hors-ligne-snapshots-lots (lot WP21, T087 et T089) : tout ce que les
// suites du dossier `end-to-end/offline-*` partagent. Rien n'est copié des lots précédents : on assemble leurs aides
// (`createMediaWorld`, `startHttpsApp`, `TestTerminal`, travailleurs réels de WP11, WP12 et WP13).
//   - `SnapshotPipeline` : les trois travailleurs de snapshots (contenu, enveloppes, signature) sur les vrais rôles de
//     base (`cashless_snapcontent`, `cashless_snapsign`), bornés au grand livre du test (la base de lot peut en
//     contenir d'autres) et lancés chacun sur sa propre boucle de 1 s, comme les deux processus de production ;
//   - `verifySnapshot` / `openSnapshotPassword` : ce que fera le terminal (signature, empreinte, mot de passe) ;
//   - `OfflineDataset` : prestataire, événement, grand livre, N terminaux et N bracelets posés en SQL par blocs.
// Écritures directes en base : amorçage seulement. Nettoyage par prestataire (`close`), jamais de TRUNCATE.
import 'reflect-metadata';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import {
  fromWrappedKey,
  openForRecipient,
  openPwdPack,
  pwdPackAad,
  sealPwdPack,
  snapshotKeyAad,
  snapshotPwdAad,
  type WrappedKey,
} from '@cashless/tag-format';
import canonicalize from 'canonicalize';
import { Pool } from 'pg';
import { AdvisorySession } from '../../src/db/advisory-session';
import { TenantTx } from '../../src/db/tenant-tx';
import { FakeDeviceCa } from '../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../src/device-tokens/device-token.service';
import { FakeKms, TEST_WRAPPING_KEY_REF } from '../../src/kms/fake-kms';
import { DataKeyRepository } from '../../src/media/keys/data-key.repository';
import { DekCache } from '../../src/media/keys/dek-cache';
import { WorkerRegistry } from '../../src/processes/worker';
import { DeviceWrappingRepository } from '../../src/snapshots-content/crypto/device-wrapping.repository';
import { DeviceWrappingWorker } from '../../src/snapshots-content/crypto/device-wrapping.worker';
import { SnapshotEntryEncryptor } from '../../src/snapshots-content/crypto/snapshot-entry-encryptor';
import { SnapshotKeyWrapper } from '../../src/snapshots-content/crypto/snapshot-key-wrapper';
import { SnapshotContentWorker } from '../../src/snapshots-content/snapshot-content.worker';
import {
  SnapshotDraftRepository,
  type Target,
} from '../../src/snapshots-content/snapshot-draft.repository';
import { SnapshotSignerRepository } from '../../src/snapshots-signer/snapshot-signer.repository';
import { SnapshotSignerWorker } from '../../src/snapshots-signer/snapshot-signer.worker';
import { startHttpsApp, type HttpsTestApp } from './app';
import { OWNER_URL, withOwner } from './db';
import type { TestPerson } from './fake-idp';
import { createBatch, createMediaWorld, MEDIA_KEY_INDEX, type MediaWorld } from './media-fixtures';
import { send, TestTerminal, type TerminalResponse } from './test-terminal';
import { activateKey } from '../integration/snapshots-signer/support';

/**
 * URL d'un rôle de processus sur la MÊME base que le propriétaire de la suite : `db.ts` retombe sur `cashless_test` si
 * `DATABASE_URL_SNAPCONTENT` / `DATABASE_URL_SNAPSIGN` ne sont pas posées (incident de WP12) ; ici jamais.
 */
const roleOnOwnerDatabase = (envName: string, role: string, passwordEnv: string): string =>
  process.env[envName] ||
  OWNER_URL.replace(
    /^postgres:\/\/[^@]*@/,
    `postgres://${role}:${process.env[passwordEnv] || `${role}_local`}@`,
  );
const SNAPCONTENT_URL = roleOnOwnerDatabase(
  'DATABASE_URL_SNAPCONTENT',
  'cashless_snapcontent',
  'CASHLESS_SNAPCONTENT_PASSWORD',
);
const SNAPSIGN_URL = roleOnOwnerDatabase(
  'DATABASE_URL_SNAPSIGN',
  'cashless_snapsign',
  'CASHLESS_SNAPSIGN_PASSWORD',
);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------------------------------------ horloge

/**
 * Avance de l'horloge de la base sur celle de Node, en ms (positive si la base est en avance). Sur le poste local la
 * base tourne dans une VM dont l'horloge dérive de plusieurs secondes ; en CI (Linux) l'écart est nul.
 */
export async function dbClockSkewMs(): Promise<number> {
  return withOwner(async (db) => {
    const before = Date.now();
    const { rows } = await db.query<{ t: Date }>('SELECT clock_timestamp() AS t');
    return rows[0]!.t.getTime() - (before + Date.now()) / 2;
  });
}

/**
 * Attend que l'horloge de la base ait dépassé les dates que la suite vient d'écrire (enrôlement, session, configuration
 * servie) vues de Node : une opération datée de Node ne doit pas précéder l'état du terminal daté de la base.
 */
export async function settleClock(extraMs = 400): Promise<void> {
  const skew = await dbClockSkewMs();
  await sleep(Math.max(0, Math.ceil(skew)) + extraMs);
}

// ------------------------------------------------------------------------------------------------ personnes

/** Appel d'une personne (jeton d'accès) en HTTPS réel ; `body` chaîne = texte envoyé tel quel. */
export function personCall(
  api: HttpsTestApp,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  who: TestPerson | null,
  body?: unknown,
  key: string | null = method === 'GET' ? null : randomUUID(),
): Promise<TerminalResponse> {
  const payload =
    method === 'GET' ? '' : typeof body === 'string' ? body : JSON.stringify(body ?? {});
  return send(
    {
      url: new URL(`${api.baseUrl}${path}`),
      method,
      headers: {
        ...(who ? { authorization: `Bearer ${who.token}` } : {}),
        ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
        ...(key !== null ? { 'idempotency-key': key } : {}),
      },
      body: payload,
      cert: null,
      key: null,
    },
    api.tls.serverCaPem,
  );
}

// ------------------------------------------------------------------------------------------------ terminal

interface ServedEntry {
  token_hash: string;
  nfc_uid: string;
  status: string;
  spendable: number;
  pwd_pack_enc: { nonce: string; ciphertext: string; tag: string } | null;
  [field: string]: unknown;
}

export interface ServedSnapshot {
  header: Record<string, unknown> & { version: number; kind: string; content_sha256: string };
  signature: string;
  pwd_pack_key?: WrappedKey;
  entries: ServedEntry[];
  removed_token_hashes: string[];
}

/** Signature ECDSA P-256 / SHA-256 de `JCS(header)` (DER, base64) contre la clé publique SPKI (base64) de la configuration. */
export function verifySnapshotSignature(
  snapshot: ServedSnapshot,
  publicKeySpkiBase64: string,
): boolean {
  const key = createPublicKey({
    key: Buffer.from(publicKeySpkiBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return verify(
    'sha256',
    Buffer.from(canonicalize(snapshot.header)!, 'utf8'),
    key,
    Buffer.from(snapshot.signature, 'base64'),
  );
}

/** `content_sha256` recalculé par le terminal : entrées sans `pwd_pack_enc`, retirés, JCS. */
export function snapshotContentSha256(snapshot: ServedSnapshot): string {
  const entries = snapshot.entries.map(({ pwd_pack_enc: _blob, ...rest }) => rest);
  const text = canonicalize({ entries, removed_token_hashes: snapshot.removed_token_hashes })!;
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Ouvre le mot de passe d'une entrée comme le terminal : enveloppe de la version, puis mot de passe sous `K_v`. */
export function openSnapshotPassword(
  snapshot: ServedSnapshot,
  terminal: TestTerminal,
  ledgerId: string,
  entry: ServedEntry,
): Buffer {
  const version = BigInt(snapshot.header.version);
  const kv = openForRecipient({
    recipientPrivateKey: terminal.agreement.scalar,
    blob: fromWrappedKey(snapshot.pwd_pack_key!),
    aad: snapshotKeyAad(ledgerId, version, terminal.deviceId),
  });
  const blob = Buffer.concat([
    Buffer.from(entry.pwd_pack_enc!.nonce, 'base64'),
    Buffer.from(entry.pwd_pack_enc!.ciphertext, 'base64'),
    Buffer.from(entry.pwd_pack_enc!.tag, 'base64'),
  ]);
  return openPwdPack({
    dek: kv,
    blob,
    aad: snapshotPwdAad(
      ledgerId,
      version,
      Buffer.from(entry.token_hash, 'hex'),
      Buffer.from(entry.nfc_uid, 'hex'),
    ),
  });
}

/** `GET /offline-snapshots/current` par le terminal, sur HTTPS réel. */
export function getSnapshot(
  api: HttpsTestApp,
  terminal: TestTerminal,
  sinceVersion?: number,
): Promise<TerminalResponse> {
  return terminal.request(api.baseUrl, api.tls.serverCaPem, {
    method: 'GET',
    path: `/offline-snapshots/current${sinceVersion === undefined ? '' : `?since_version=${sinceVersion}`}`,
  });
}

// ------------------------------------------------------------------------------------------------ travailleurs

/** Dépôt du processus snapshot-content borné au grand livre du test. */
class LedgerContentRepo extends SnapshotDraftRepository {
  constructor(
    tx: TenantTx,
    private readonly ledgers: Set<string>,
    locks: AdvisorySession,
  ) {
    super(tx, locks);
  }
  override async targets(): Promise<Target[]> {
    return (await super.targets()).filter((t) => this.ledgers.has(t.ledgerId));
  }
}

class LedgerWrappingRepo extends DeviceWrappingRepository {
  constructor(
    tx: TenantTx,
    private readonly ledgers: Set<string>,
  ) {
    super(tx);
  }
  override async toWrap(limit: number) {
    return (await super.toWrap(limit)).filter((row) => this.ledgers.has(row.ledgerId));
  }
}

class LedgerSignerRepo extends SnapshotSignerRepository {
  constructor(
    tx: TenantTx,
    private readonly ledgers: Set<string>,
  ) {
    super(tx);
  }
  override async readyDrafts() {
    return (await super.readyDrafts()).filter((draft) => this.ledgers.has(draft.ledgerId));
  }
}

export interface PipelineTarget {
  operatorId: string;
  ledgerId: string;
}

/**
 * Les deux processus de snapshots de production, dans le processus du test : contenu + enveloppes (`cashless_snapcontent`)
 * et signataire (`cashless_snapsign`), chacun sur sa boucle (`SNAPSHOT_POLL_SECONDS` = 1 s, boucles non alignées comme
 * deux processus distincts). Mêmes classes que les processus, mêmes rôles de base, faux service de clés.
 */
export class SnapshotPipeline {
  readonly content: SnapshotContentWorker;
  readonly wrapping: DeviceWrappingWorker;
  readonly signer: SnapshotSignerWorker;
  readonly errors: unknown[] = [];
  private readonly contentPool: Pool;
  private readonly signPool: Pool;
  private readonly contentRepo: LedgerContentRepo;
  /** Grands livres traités (le premier est `target.ledgerId` ; `addLedger` en ajoute en cours de route). */
  readonly ledgers: Set<string>;
  private running = false;
  private loops: Promise<void>[] = [];

  constructor(
    readonly target: PipelineTarget,
    readonly kms: FakeKms,
    keyRef: string,
    private readonly pollMs = 1000,
  ) {
    this.ledgers = new Set([target.ledgerId]);
    this.contentPool = new Pool({ connectionString: SNAPCONTENT_URL, max: 10 });
    this.signPool = new Pool({ connectionString: SNAPSIGN_URL, max: 4 });
    const tx = new TenantTx(this.contentPool as never);
    // Antémémoire de la clé de données au réglage de production (TAG_DEK_CACHE_SECONDS : 300).
    const cache = new DekCache({ tagDekCacheSeconds: 300 });
    const encryptor = new SnapshotEntryEncryptor(kms, kms, tx, new DataKeyRepository(), cache, {
      tagWrappingKeyRef: TEST_WRAPPING_KEY_REF,
    });
    this.contentRepo = new LedgerContentRepo(
      tx,
      this.ledgers,
      new AdvisorySession(this.contentPool as never),
    );
    this.content = new SnapshotContentWorker(new WorkerRegistry(), this.contentRepo, encryptor, {
      now: () => new Date(),
      fullEveryMs: 3_600_000,
      orphanDelayMs: 600_000,
      graceMs: 5000,
      // Comme le processus en boucle (hors `--once`) : un FULL lent tourne détaché et ne retarde pas les autres grands livres.
      settleAll: false,
    });
    this.wrapping = new DeviceWrappingWorker(
      new WorkerRegistry(),
      new LedgerWrappingRepo(tx, this.ledgers),
      new SnapshotKeyWrapper(kms, { tagWrappingKeyRef: TEST_WRAPPING_KEY_REF }),
    );
    this.signer = new SnapshotSignerWorker(
      new WorkerRegistry(),
      new LedgerSignerRepo(new TenantTx(this.signPool as never), this.ledgers),
      kms,
      { snapshotSigningKeyRef: keyRef } as never,
    );
  }

  /** Ajoute un grand livre (celui d'un autre jeu de données) aux travailleurs en marche. */
  addLedger(ledgerId: string): void {
    this.ledgers.add(ledgerId);
  }

  /** Un tour des trois travailleurs, dans l'ordre du flux (contenu, signature, enveloppes). */
  async pass(): Promise<void> {
    await this.content.runOnce();
    await this.signer.runOnce();
    await this.wrapping.runOnce();
  }

  /** Lance les boucles de fond (contenu, signataire, enveloppes), chacune avec sa propre cadence. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async (run: () => Promise<unknown>, offsetMs: number): Promise<void> => {
      await sleep(offsetMs);
      while (this.running) {
        try {
          await run();
        } catch (error) {
          this.errors.push(error);
        }
        await sleep(this.pollMs);
      }
    };
    this.loops = [
      loop(() => this.content.runOnce(), 0),
      loop(() => this.signer.runOnce(), Math.floor(this.pollMs / 3)),
      loop(() => this.wrapping.runOnce(), Math.floor((2 * this.pollMs) / 3)),
    ];
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all(this.loops);
    this.loops = [];
  }

  async close(): Promise<void> {
    await this.stop();
    await this.contentRepo.close();
    await this.contentPool.end();
    await this.signPool.end();
  }

  /** Dernière version publiée du grand livre (0 si aucune). */
  async latestVersion(ledgerId = this.target.ledgerId): Promise<number> {
    return withOwner(async (db) => {
      const { rows } = await db.query<{ v: string | null }>(
        'SELECT max(version)::text AS v FROM offline_snapshot WHERE ledger_id = $1',
        [ledgerId],
      );
      return Number(rows[0]!.v ?? 0);
    });
  }

  /** Versions ayant une enveloppe pour ce terminal. */
  async enveloped(deviceId: string): Promise<number[]> {
    return withOwner(async (db) => {
      const { rows } = await db.query<{ version: string }>(
        `SELECT version::text FROM offline_snapshot_key
          WHERE ledger_id = $1 AND device_id = $2 ORDER BY version`,
        [this.target.ledgerId, deviceId],
      );
      return rows.map((row) => Number(row.version));
    });
  }

  /** Attend (sondage de `stepMs`) que `check` soit vrai ; rend la durée écoulée en ms, ou échoue. */
  async until(
    check: () => Promise<boolean>,
    timeoutMs: number,
    what: string,
    stepMs = 100,
  ): Promise<number> {
    const start = Date.now();
    for (;;) {
      if (this.errors.length > 0) throw this.errors[0];
      if (await check()) return Date.now() - start;
      if (Date.now() - start > timeoutMs)
        throw new Error(`${what} : non obtenu en ${timeoutMs} ms`);
      await sleep(stepMs);
    }
  }
}

// ------------------------------------------------------------------------------------------------ jeu de données

export interface DatasetOptions {
  /** Bracelets ACTIFS (portefeuille unique, mot de passe scellé sous la clé de données), posés par blocs en SQL. */
  bracelets: number;
  /** Terminaux enrôlés (HTTPS réel) dans l'événement, éligibles aux snapshots. */
  terminals?: number;
}

const CHUNK = 5000;

/**
 * Prestataire, événement, grand livre, clé de signature, clé de données, N terminaux et N bracelets. Le monde de base est
 * celui de `createMediaWorld` (personnes, jetons). 50 000 bracelets pour les mesures (paramètre), 200 pour les parcours.
 */
export class OfflineDataset {
  w!: MediaWorld;
  api!: HttpsTestApp;
  kms = new FakeKms();
  keyRef = `fake-kms:ecc:snap-${randomUUID()}`;
  keyId = '';
  walletId = randomUUID();
  batchId = '';
  dekId = '';
  dek!: Buffer;
  terminals: TestTerminal[] = [];
  pipeline!: SnapshotPipeline;
  /** Durée de pose des bracelets, en ms. */
  braceletsMs = 0;
  private owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  private tokens!: DeviceTokenService;
  private ca!: FakeDeviceCa;
  private created = 0;

  get operatorId(): string {
    return this.w.ops.a;
  }
  get ledgerId(): string {
    return this.w.ids.ledgerA;
  }
  get eventId(): string {
    return this.w.ids.eventA;
  }

  static async create(options: DatasetOptions): Promise<OfflineDataset> {
    const d = new OfflineDataset();
    d.w = await createMediaWorld();
    d.api = await startHttpsApp(undefined, { identity: d.w.idp });
    d.ca = await FakeDeviceCa.fromFiles({
      certFile: d.api.tls.deviceCaCertFile,
      keyFile: d.api.tls.deviceCaFakeKeyFile,
    });
    d.tokens = d.api.app.get(DeviceTokenService, { strict: false });
    const dek = await d.kms.generateDataKey(TEST_WRAPPING_KEY_REF);
    d.dek = dek.plaintext;
    await d.inOperator(async (query) => {
      d.batchId = await createBatch({ query } as never, {
        operatorId: d.operatorId,
        organizerId: d.w.ids.organizerA,
        eventId: d.eventId,
        status: 'ACTIVE',
        quantity: options.bracelets,
      });
      d.dekId = (
        await query(
          `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref,
                                     encrypted_dek, status)
           VALUES ($1, $2, 1 + coalesce((SELECT max(version) FROM tag_data_key
                                          WHERE operator_id = $1 AND key_index = $2), 0), $3, $4,
                   'ACTIVE') RETURNING id`,
          [d.operatorId, MEDIA_KEY_INDEX, TEST_WRAPPING_KEY_REF, dek.encrypted],
        )
      ).rows[0]!.id;
      await query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
        d.walletId,
        d.operatorId,
        d.ledgerId,
      ]);
      await query(
        `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale,
                                     max_per_media_per_device, max_total_per_device)
         VALUES ($1, 'EVENT', $2, true, 5000, 20000, 300000)`,
        [d.operatorId, d.eventId],
      );
    });
    d.keyId = await activateKey(d.owner, d.kms, d.keyRef, d.operatorId);
    for (let n = 0; n < (options.terminals ?? 1); n += 1) await d.addTerminal();
    d.pipeline = new SnapshotPipeline(
      { operatorId: d.operatorId, ledgerId: d.ledgerId },
      d.kms,
      d.keyRef,
    );
    await d.addBracelets(options.bracelets);
    return d;
  }

  /** Une seule clé de signature pour les deux jeux (un processus de signature n'a qu'une référence de clé). */
  async adoptSigningKeyOf(other: OfflineDataset): Promise<void> {
    this.keyId = await activateKey(this.owner, other.kms, other.keyRef, this.operatorId);
  }

  /** Une transaction du propriétaire, dans le prestataire du jeu. */
  async inOperator<T>(
    fn: (query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string } & Record<string, unknown>> }>) => Promise<T>,
  ): Promise<T> {
    const client = await this.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [this.operatorId]);
      const out = await fn((sql, params) => client.query(sql, params as never) as never);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Terminal enrôlé (trois preuves), jeton posé, clé d'accord réelle : éligible aux snapshots. */
  async addTerminal(): Promise<TestTerminal> {
    const t = await withOwner((db) =>
      new TestTerminal('ANDROID').enroll(db, {
        operatorId: this.operatorId,
        eventId: this.eventId,
        ca: this.ca,
      }),
    );
    await t.issueToken(this.tokens);
    this.terminals.push(t);
    return t;
  }

  /**
   * Pose `n` bracelets ACTIFS par blocs de 5 000 : identifiants, UID et mots de passe scellés calculés par Node (la
   * clé d'authentification lie chaque mot de passe à son bracelet), insertion par `unnest` en SQL.
   */
  async addBracelets(n: number): Promise<string[]> {
    const start = Date.now();
    const all: string[] = [];
    for (let done = 0; done < n; done += CHUNK) {
      const size = Math.min(CHUNK, n - done);
      const ids: string[] = [];
      const uids: Buffer[] = [];
      const blobs: Buffer[] = [];
      for (let i = 0; i < size; i += 1) {
        const id = randomUUID();
        const uid = randomBytes(7);
        ids.push(id);
        uids.push(uid);
        blobs.push(
          sealPwdPack({
            dek: this.dek,
            nonce: randomBytes(12),
            pwdPack: randomBytes(6),
            aad: pwdPackAad({
              mediaId: id,
              operatorId: this.operatorId,
              keyIndex: MEDIA_KEY_INDEX,
              uid,
            }),
          }),
        );
      }
      await this.inOperator((query) =>
        query(
          `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index,
                              wallet_id, status, pwd_pack_enc, pwd_pack_dek_id)
           SELECT m.id, $1, 'NFC_TAG', sha256(m.id::text::bytea), m.uid, $2, $3, $4, 'ACTIVE', m.blob, $5
             FROM unnest($6::uuid[], $7::bytea[], $8::bytea[]) AS m(id, uid, blob)`,
          [
            this.operatorId,
            this.batchId,
            MEDIA_KEY_INDEX,
            this.walletId,
            this.dekId,
            ids,
            uids,
            blobs,
          ],
        ),
      );
      this.created += size;
      all.push(...ids);
    }
    this.braceletsMs += Date.now() - start;
    return all;
  }

  get braceletCount(): number {
    return this.created;
  }

  /** Bloque un bracelet (liste noire) par la route du back-office ; rend le `media_id`. */
  async anyMediaId(): Promise<string> {
    const { rows } = await withOwner((db) =>
      db.query<{ id: string }>(
        `SELECT id FROM media WHERE wallet_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [this.walletId],
      ),
    );
    return rows[0]!.id;
  }

  async close(): Promise<void> {
    await this.pipeline?.close();
    await this.api?.close();
    // Nettoyage par prestataire : brouillons de snapshots restants (les écritures du grand livre sont
    // immuables par construction et restent, rattachées au prestataire jetable du test).
    await this.owner
      .query(
        `UPDATE offline_snapshot_draft SET status = 'DISCARDED', discard_reason = 'wp21'
          WHERE operator_id = $1 AND status IN ('OPEN','READY')`,
        [this.operatorId],
      )
      .catch(() => undefined);
    await this.owner.end();
  }
}
