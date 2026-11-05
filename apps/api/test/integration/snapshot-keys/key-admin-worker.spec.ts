// Intégration : travailleur snapshot-key-admin (WP09, T041). Sous le propriétaire (droits de rôle : WP08).
import { Pool } from 'pg';
import { AuditService } from '../../../src/audit/audit.service';
import { TenantTx } from '../../../src/db/tenant-tx';
import { FakeKms } from '../../../src/kms/fake-kms';
import { WorkerRegistry } from '../../../src/processes/worker';
import {
  ROTATE_ACTOR_VARIABLE,
  SnapshotKeyAdminWorker,
} from '../../../src/snapshot-keys/snapshot-key-admin.worker';
import { SnapshotKeyRotation } from '../../../src/snapshot-keys/snapshot-key-rotation.service';
import { OWNER_URL } from '../../support/db';

const ACTOR = '90000000-0000-0000-0000-000000000009';

describe('SnapshotKeyAdminWorker', () => {
  let pool: Pool;
  const makeWorker = (kms: FakeKms) => {
    const tx = new TenantTx(pool as never);
    const audit = new AuditService();
    return new SnapshotKeyAdminWorker(
      new WorkerRegistry(),
      tx,
      audit,
      new SnapshotKeyRotation(tx, audit),
      kms,
    );
  };
  const keys = async () =>
    (await pool.query('SELECT key_id, status, kms_key_ref FROM snapshot_signing_key')).rows;

  beforeAll(() => {
    pool = new Pool({ connectionString: OWNER_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env[ROTATE_ACTOR_VARIABLE];
    await pool.query('DELETE FROM snapshot_signing_key');
    // Le journal est en ajout seul : les « créations » des essais précédents sont adoptées (REVOKED) pour ne pas
    // être reprises ; les assertions ignorent ces lignes `old-`.
    await pool.query(
      `INSERT INTO snapshot_signing_key (key_id, owner, algorithm, public_key, kms_key_ref, status)
       SELECT 'old-' || a.id, 'CENTRAL', 'ECDSA_P256_SHA256', decode(repeat('00', 91), 'hex'),
              a.object_id, 'REVOKED'
         FROM audit_log a WHERE a.action = 'SNAPSHOT_SIGNING_KEY_CREATED'`,
    );
  });
  afterEach(() => {
    delete process.env[ROTATE_ACTOR_VARIABLE];
  });

  const real = async () =>
    (await keys()).filter((k: { key_id: string }) => !k.key_id.startsWith('old-'));

  it('--once sans acteur : 0 unité, aucune clé créée, aucun appel au service de clés', async () => {
    const kms = new FakeKms();
    expect(await makeWorker(kms).runOnce()).toBe(0);
    expect(kms.calls.createKey + kms.calls.publicKey).toBe(0);
    expect(await real()).toHaveLength(0);
    process.env[ROTATE_ACTOR_VARIABLE] = 'pas-un-uuid';
    expect(await makeWorker(kms).runOnce()).toBe(0);
    expect(kms.calls.createKey).toBe(0);
  });

  it('avec l’acteur : crée la clé, une ACTIVE, une seule rotation par processus', async () => {
    process.env[ROTATE_ACTOR_VARIABLE] = ACTOR;
    const kms = new FakeKms();
    const worker = makeWorker(kms);
    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(0);
    const rows = await real();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE' });
    expect(kms.calls.createKey).toBe(1);
    const audit = await pool.query(
      "SELECT actor_id FROM audit_log WHERE action = 'SNAPSHOT_SIGNING_KEY_ROTATED' AND object_id = $1",
      [rows[0].key_id],
    );
    expect(audit.rows[0].actor_id).toBe(ACTOR);
  });

  it('reprise après arrêt entre création et rotation : aucune seconde clé', async () => {
    process.env[ROTATE_ACTOR_VARIABLE] = ACTOR;
    const first = new FakeKms();
    first.failNext('publicKey');
    await expect(makeWorker(first).runOnce()).rejects.toThrow();
    expect(first.calls.createKey).toBe(1);
    expect(await real()).toHaveLength(0);
    const second = new FakeKms();
    expect(await makeWorker(second).runOnce()).toBe(1);
    expect(second.calls.createKey).toBe(0);
    const rows = await real();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE' });
  });

  it('--list décrit la rotation en attente', async () => {
    const worker = makeWorker(new FakeKms());
    expect((await worker.describe())[0]).toMatch(/en attente de SNAPSHOT_KEY_ROTATE_ACTOR/);
    process.env[ROTATE_ACTOR_VARIABLE] = ACTOR;
    expect((await worker.describe())[0]).toContain(ACTOR);
  });
});
