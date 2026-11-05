// Support des tests d'intégration de WP12 : prestataire, grand livre et terminaux à clés d'accord
// réelles,
// bracelets portant un mot de passe chiffré sous une clé de données, jeu de travailleurs bornés au
// grand
// livre du test (la base de lot peut en contenir d'autres : aucun test n'affirme rien de global).
import { createECDH, randomBytes, randomUUID, createHash } from 'node:crypto';
import { pwdPackAad, sealPwdPack } from '@cashless/tag-format';
import { Pool } from 'pg';
import { AdvisorySession } from '../../src/db/advisory-session';
import { TenantTx } from '../../src/db/tenant-tx';
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

const env = process.env;
export const SNAPCONTENT_URL =
  env.DATABASE_URL_SNAPCONTENT ||
  'postgres://cashless_snapcontent:' +
    `${env.CASHLESS_SNAPCONTENT_PASSWORD || 'cashless_snapcontent_local'}` +
    `@${env.PGHOST || '127.0.0.1'}:${env.PGPORT || '5433'}/${env.PGDATABASE || 'cashless_test'}`;

/** Mot de passe de bracelet reconnaissable (6 octets distincts). */
export const CANARY = Buffer.from('c4a55e7f0199', 'hex');

export interface Terminal {
  id: string;
  privateKey: Buffer;
  publicKey: Buffer;
}

export interface Bracelet {
  mediaId: string;
  tokenHash: Buffer;
  uid: Buffer;
}

export interface Fixture {
  operatorId: string;
  ledgerId: string;
  eventId: string;
  walletId: string;
  batchId: string;
  keyId: string;
  dekId: string;
}

export function newTerminal(): Terminal {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { id: randomUUID(), privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey() };
}

async function inTx<T>(
  owner: Pool,
  operatorId: string | null,
  fn: (c: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    if (operatorId)
      await client.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Prestataire, événement LIVE, grand livre, clé de signature, clé de données, lot de bracelets. */
export async function createFixture(owner: Pool, kms: FakeKms): Promise<Fixture> {
  const f: Fixture = {
    operatorId: randomUUID(),
    ledgerId: '',
    eventId: randomUUID(),
    walletId: randomUUID(),
    batchId: randomUUID(),
    keyId: `k-${randomUUID()}`,
    dekId: '',
  };
  const organizer = randomUUID();
  const jurisdiction = randomUUID();
  const dek = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
  dek.plaintext.fill(0);
  await inTx(owner, null, async (c) => {
    await c.query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
        WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
    );
    await c.query(
      `INSERT INTO party (id, kind, legal_name, country_code)
       VALUES ($1, 'OPERATOR', 'WP12', 'SN')`,
      [f.operatorId],
    );
    await c.query(
      `INSERT INTO party (id, kind, operator_id, legal_name)
       VALUES ($1, 'ORGANIZER', $2, 'Org WP12')`,
      [organizer, f.operatorId],
    );
    await c.query(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from,
                                         breakage_destination)
       VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
      [jurisdiction, Math.floor(Math.random() * 1e9)],
    );
    await c.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                          funds_holder, status)
       VALUES ($1, $2, $3, 'Evt WP12', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', 'LIVE')`,
      [f.eventId, f.operatorId, organizer, jurisdiction],
    );
    await c.query("SELECT set_config('app.operator_id', $1, true)", [f.operatorId]);
    await c.query('SELECT open_event_ledger($1)', [f.eventId]);
    f.ledgerId = (
      await c.query('SELECT id FROM ledger WHERE scope_id = $1', [f.eventId])
    ).rows[0].id;
    await c.query(
      `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale,
                                   max_per_media_per_device, max_total_per_device)
       VALUES ($1, 'EVENT', $2, true, 5000, 10000, 100000)`,
      [f.operatorId, f.eventId],
    );
    await c.query(
      `INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key,
                                         kms_key_ref, status)
       VALUES ($1, $2, 'CENTRAL', 'ECDSA_P256_SHA256', '\\x01', $3, 'ACTIVE')`,
      [f.keyId, f.operatorId, `test:${f.keyId}`],
    );
    await c.query(
      "INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES ($1, $2, $3, 'ACTIVE')",
      [f.walletId, f.operatorId, f.ledgerId],
    );
    await c.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
       VALUES ($1, 1, $2, 'ACTIVE')`,
      [f.operatorId, `test:hmac-${f.operatorId}`],
    );
    f.dekId = (
      await c.query(
        `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref,
                                   encrypted_dek, status)
         VALUES ($1, 1, 1, $2, $3, 'ACTIVE') RETURNING id`,
        [f.operatorId, TEST_WRAPPING_KEY_REF, dek.encrypted],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index,
                                status)
       VALUES ($1, $2, $3, $4, 'PUBLIC', 99, 1, 'ACTIVE')`,
      [f.batchId, f.operatorId, organizer, f.eventId],
    );
  });
  return f;
}

/** La clé de données du jeu d'essai en clair (la base ne la contient que chiffrée). */
export async function dekPlaintext(owner: Pool, kms: FakeKms, f: Fixture): Promise<Buffer> {
  const { rows } = await owner.query('SELECT encrypted_dek FROM tag_data_key WHERE id = $1', [
    f.dekId,
  ]);
  return kms.decrypt(TEST_WRAPPING_KEY_REF, rows[0].encrypted_dek);
}

export async function addTerminal(
  owner: Pool,
  f: Fixture,
  terminal: Terminal,
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' = 'ACTIVE',
): Promise<void> {
  await inTx(owner, f.operatorId, async (c) => {
    await c.query(
      `INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key)
       VALUES ($1, $2, 'POS', 'CATALOG_POS', $3, $4, $5)`,
      [terminal.id, f.operatorId, f.eventId, `S-${randomUUID()}`, terminal.publicKey],
    );
    if (status !== 'ACTIVE')
      await c.query('UPDATE device SET status = $2 WHERE id = $1', [terminal.id, status]);
  });
}

/** Bracelet ACTIF dont le mot de passe (PWD‖PACK) est chiffré sous la clé de données du lot. */
export async function addBracelet(
  owner: Pool,
  f: Fixture,
  dek: Buffer,
  pwdPack: Buffer | null = CANARY,
): Promise<Bracelet> {
  const mediaId = randomUUID();
  const uid = randomBytes(7);
  const blob =
    pwdPack === null
      ? null
      : sealPwdPack({
          dek,
          nonce: randomBytes(12),
          pwdPack,
          aad: pwdPackAad({ mediaId, operatorId: f.operatorId, keyIndex: 1, uid }),
        });
  const tokenHash = createHash('sha256').update(mediaId).digest();
  await inTx(owner, f.operatorId, async (c) => {
    await c.query(
      `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index,
                          wallet_id, status, pwd_pack_enc, pwd_pack_dek_id)
       VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 1, $6, 'ACTIVE', $7, $8)`,
      [mediaId, f.operatorId, tokenHash, uid, f.batchId, f.walletId, blob, blob ? f.dekId : null],
    );
  });
  return { mediaId, tokenHash, uid };
}

/** Joue le signataire : publie le brouillon READY (la base ne vérifie pas la signature). */
export async function publishReady(owner: Pool, f: Fixture): Promise<number> {
  return inTx(owner, f.operatorId, async (c) => {
    const { rows } = await c.query(
      "SELECT id FROM offline_snapshot_draft WHERE ledger_id = $1 AND status = 'READY'",
      [f.ledgerId],
    );
    const { rows: out } = await c.query(
      "SELECT version FROM publish_offline_snapshot($1, $2, '\\x3045'::bytea)",
      [rows[0].id, f.keyId],
    );
    return Number(out[0].version);
  });
}

class ScopedContentRepo extends SnapshotDraftRepository {
  constructor(
    tx: TenantTx,
    private readonly ledger: string,
    locks: AdvisorySession,
  ) {
    super(tx, locks);
  }
  override async targets(): Promise<Target[]> {
    return (await super.targets()).filter((t) => t.ledgerId === this.ledger);
  }
}

export class ScopedWrappingRepo extends DeviceWrappingRepository {
  /** Appels de `store` à faire échouer (panne de la base à mi-chemin). */
  failStore = false;
  constructor(
    tx: TenantTx,
    private readonly ledger: string,
  ) {
    super(tx);
  }
  override async toWrap(limit: number) {
    return (await super.toWrap(limit)).filter((row) => row.ledgerId === this.ledger);
  }
  override async store(...args: Parameters<DeviceWrappingRepository['store']>) {
    if (this.failStore) throw new Error('panne de base simulée');
    return super.store(...args);
  }
}

export interface Workers {
  content: SnapshotContentWorker;
  wrapping: DeviceWrappingWorker;
  wrappingRepo: ScopedWrappingRepo;
  encryptor: SnapshotEntryEncryptor;
  close(): Promise<void>;
}

/** Travailleurs réels (chiffreur, enveloppes) sur le pool du rôle `cashless_snapcontent`. */
export function makeWorkers(pool: Pool, f: Fixture, kms: FakeKms): Workers {
  const tx = new TenantTx(pool as never);
  const cache = new DekCache({ tagDekCacheSeconds: 0 });
  const encryptor = new SnapshotEntryEncryptor(kms, kms, tx, new DataKeyRepository(), cache, {
    tagWrappingKeyRef: TEST_WRAPPING_KEY_REF,
  });
  const locks = new AdvisorySession(pool as never);
  const repo = new ScopedContentRepo(tx, f.ledgerId, locks);
  const content = new SnapshotContentWorker(new WorkerRegistry(), repo, encryptor, {
    now: () => new Date(),
    fullEveryMs: 3_600_000,
    orphanDelayMs: 600_000,
    graceMs: 5000,
    settleAll: true,
  });
  const wrappingRepo = new ScopedWrappingRepo(tx, f.ledgerId);
  const wrapping = new DeviceWrappingWorker(
    new WorkerRegistry(),
    wrappingRepo,
    new SnapshotKeyWrapper(kms, { tagWrappingKeyRef: TEST_WRAPPING_KEY_REF }),
  );
  return { content, wrapping, wrappingRepo, encryptor, close: () => repo.close() };
}
