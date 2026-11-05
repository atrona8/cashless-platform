// Intégration : rotation de la clé de signature des snapshots (WP09, T041). Sous le PROPRIÉTAIRE : les droits de
// cashless_keyadmin sur rotate_snapshot_signing_key arrivent avec WP08.
import { Pool } from 'pg';
import { AuditService } from '../../../src/audit/audit.service';
import { TenantTx } from '../../../src/db/tenant-tx';
import { FakeKms } from '../../../src/kms/fake-kms';
import { SnapshotKeyRotation } from '../../../src/snapshot-keys/snapshot-key-rotation.service';
import { InvalidSigningPublicKeyError } from '../../../src/snapshot-keys/spki-p256';
import { OWNER_URL } from '../../support/db';

const ACTOR = '90000000-0000-0000-0000-000000000009';

describe('SnapshotKeyRotation', () => {
  let pool: Pool;
  let rotation: SnapshotKeyRotation;
  const kms = new FakeKms();

  beforeAll(() => {
    pool = new Pool({ connectionString: OWNER_URL });
    rotation = new SnapshotKeyRotation(new TenantTx(pool as never), new AuditService());
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM snapshot_signing_key');
  });

  const rotate = async (suffix: string, actorId = ACTOR) => {
    const ref = await kms.createKey('ECC_NIST_P256');
    await rotation.rotate({
      keyId: `kid-${suffix}`,
      publicKey: await kms.publicKey(ref),
      kmsKeyRef: ref,
      actorId,
    });
  };
  const statuses = async () =>
    (await pool.query('SELECT key_id, status FROM snapshot_signing_key ORDER BY created_at')).rows;

  it('crée la première clé ACTIVE, puis retire l’ancienne', async () => {
    await rotate('1');
    expect(await statuses()).toEqual([{ key_id: 'kid-1', status: 'ACTIVE' }]);
    await rotate('2');
    expect(await statuses()).toEqual([
      { key_id: 'kid-1', status: 'RETIRED' },
      { key_id: 'kid-2', status: 'ACTIVE' },
    ]);
  });

  it('la troisième clé retire la plus ancienne (jamais plus de deux valides)', async () => {
    await rotate('1');
    await rotate('2');
    await rotate('3');
    const rows = await statuses();
    expect(rows.map((r: { status: string }) => r.status).sort()).toEqual([
      'ACTIVE',
      'RETIRED',
      'REVOKED',
    ]);
  });

  it('une troisième clé valide insérée hors rotation : CL054 (borne de la base)', async () => {
    await rotate('1');
    await rotate('2');
    const ref = await kms.createKey('ECC_NIST_P256');
    await expect(
      pool.query(
        `INSERT INTO snapshot_signing_key (key_id, owner, algorithm, public_key, kms_key_ref, status)
         VALUES ('kid-3', 'CENTRAL', 'ECDSA_P256_SHA256', $1, $2, 'ACTIVE')`,
        [await kms.publicKey(ref), ref],
      ),
    ).rejects.toMatchObject({ code: 'CL054' });
  });

  it('identifiant déjà pris : CL001, aucune seconde clé, aucune ligne d’audit de plus', async () => {
    // Le journal est en ajout seul : on compte la différence, pas le total.
    const count = async () =>
      Number(
        (
          await pool.query(
            "SELECT count(*) AS n FROM audit_log WHERE action = 'SNAPSHOT_SIGNING_KEY_ROTATED'",
          )
        ).rows[0].n,
      );
    await rotate('1');
    const before = await count();
    const ref = await kms.createKey('ECC_NIST_P256');
    await expect(
      rotation.rotate({
        keyId: 'kid-1',
        publicKey: await kms.publicKey(ref),
        kmsKeyRef: ref,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'CL001' });
    expect(await statuses()).toHaveLength(1);
    expect(await count()).toBe(before);
  });

  it('clé publique de 91 octets mais pas P-256 SPKI : refusée par l’API, la base n’est pas appelée', async () => {
    await expect(
      rotation.rotate({
        keyId: 'kid-x',
        publicKey: Buffer.alloc(91, 7),
        kmsKeyRef: 'fake-kms:ecc:x',
        actorId: ACTOR,
      }),
    ).rejects.toThrow(InvalidSigningPublicKeyError);
    expect(await statuses()).toHaveLength(0);
  });

  it('audite l’acteur réel, sans clé privée', async () => {
    await rotate('1');
    const { rows } = await pool.query(
      "SELECT actor_id, origin, object_id, after FROM audit_log WHERE action = 'SNAPSHOT_SIGNING_KEY_ROTATED' AND actor_id = $1",
      [ACTOR],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[rows.length - 1]).toMatchObject({ origin: 'key-admin', object_id: 'kid-1' });
    expect(JSON.stringify(rows[rows.length - 1].after)).not.toMatch(/"d"|private/i);
  });
});
