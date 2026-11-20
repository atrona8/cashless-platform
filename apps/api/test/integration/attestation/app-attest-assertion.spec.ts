// Assertions App Attest contre la vraie base (WP13, T052) : compteur avancé par la fonction SQL
// `advance_app_attest_counter` seule, deux assertions concurrentes de même compteur (une seule
// réussit), autre prestataire, appareil révoqué, droits du rôle applicatif (aucune écriture
// directe).
import 'reflect-metadata';
import { AttestationError } from '../../../src/attestation/attestation.port';
import { IosAppAttestAssertionVerifier } from '../../../src/attestation/ios-app-attest-assertion';
import { APP_URL, connect, withOwner } from '../../support/db';
import {
  appAssertion,
  sha256,
  TEST_IOS_BUNDLE_ID,
  TEST_IOS_TEAM_ID,
} from '../../support/attestation/ios';
import { ownerRows } from '../../support/media-fixtures';
import {
  IosTestTerminal,
  openTenantClient,
  startAttestationWorld,
  type AttestationWorld,
} from './app-attest-world';

const REQUEST = sha256(Buffer.from('requête liée', 'utf8'));
const verifier = new IosAppAttestAssertionVerifier({
  teamId: TEST_IOS_TEAM_ID,
  bundleId: TEST_IOS_BUNDLE_ID,
});

describe('assertions App Attest (WP13, T052)', () => {
  let world: AttestationWorld;
  beforeAll(async () => {
    world = await startAttestationWorld(true);
  }, 60_000);
  afterAll(async () => {
    await world?.close();
  });

  const counterOf = async (deviceId: string) =>
    Number(
      (
        await ownerRows<{ counter: bigint }>(
          'SELECT counter FROM device_app_attest_key WHERE device_id = $1',
          [deviceId],
        )
      )[0]!.counter,
    );
  const assertion = (terminal: IosTestTerminal, counter: number, hash: Buffer = REQUEST) =>
    appAssertion({
      privateKey: terminal.appAttestKeys.privateKey,
      clientDataHash: hash,
      counter,
    });
  /** Vérifie dans la transaction du prestataire, valide ou annule selon l'issue. */
  async function verifyAs(operatorId: string, terminal: IosTestTerminal, raw: Buffer) {
    const tx = await openTenantClient(operatorId);
    try {
      await verifier.verify(
        { deviceId: terminal.deviceId, assertion: raw, clientDataHash: REQUEST },
        tx.client,
      );
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
  const refusedWith = async (promise: Promise<unknown>, reason: RegExp) => {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AttestationError);
    expect((error as AttestationError).reason).toMatch(reason);
  };

  it('assertion valide : compteur avancé ; rejeu et compteur inférieur refusés', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    expect(await counterOf(terminal.deviceId)).toBe(0);
    await verifyAs(world.w.ops.a, terminal, await assertion(terminal, 5));
    expect(await counterOf(terminal.deviceId)).toBe(5);
    await refusedWith(
      verifyAs(world.w.ops.a, terminal, await assertion(terminal, 5)),
      /compteur non croissant/,
    );
    await refusedWith(
      verifyAs(world.w.ops.a, terminal, await assertion(terminal, 4)),
      /compteur non croissant/,
    );
    expect(await counterOf(terminal.deviceId)).toBe(5);
    await verifyAs(world.w.ops.a, terminal, await assertion(terminal, 4_294_967_295));
    expect(await counterOf(terminal.deviceId)).toBe(4_294_967_295);
  });

  it('signature fausse : le compteur n’avance pas', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    const other = new IosTestTerminal();
    await world.enroll(other);
    const forged = await appAssertion({
      privateKey: other.appAttestKeys.privateKey,
      clientDataHash: REQUEST,
      counter: 3,
    });
    await refusedWith(verifyAs(world.w.ops.a, terminal, forged), /signature invalide/);
    expect(await counterOf(terminal.deviceId)).toBe(0);
    await verifyAs(world.w.ops.a, terminal, await assertion(terminal, 3));
    expect(await counterOf(terminal.deviceId)).toBe(3);
  });

  it('deux assertions concurrentes de même compteur : une seule réussit', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    for (const counter of [1, 2, 3]) {
      const raw = await assertion(terminal, counter);
      const outcomes = await Promise.allSettled([
        verifyAs(world.w.ops.a, terminal, raw),
        verifyAs(world.w.ops.a, terminal, raw),
      ]);
      expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(AttestationError);
      expect(await counterOf(terminal.deviceId)).toBe(counter);
    }
  });

  it('autre prestataire : refusé (RLS), compteur intact ; fonction SQL : CL059', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    await verifyAs(world.w.ops.a, terminal, await assertion(terminal, 1));
    await refusedWith(
      verifyAs(world.w.ops.b, terminal, await assertion(terminal, 2)),
      /sans clé App Attest/,
    );
    expect(await counterOf(terminal.deviceId)).toBe(1);
    // La fonction elle-même, appelée sous le mauvais prestataire avec la bonne clé : CL059.
    const [row] = await ownerRows<{ key_id: Buffer }>(
      'SELECT key_id FROM device_app_attest_key WHERE device_id = $1',
      [terminal.deviceId],
    );
    const tx = await openTenantClient(world.w.ops.b);
    await expect(
      tx.client.query('SELECT advance_app_attest_counter($1, $2, 9)', [
        terminal.deviceId,
        row!.key_id,
      ]),
    ).rejects.toMatchObject({ code: 'CL059' });
    await tx.rollback();
    expect(await counterOf(terminal.deviceId)).toBe(1);
  });

  it('appareil REVOKED : refusé (CL059 converti), compteur intact', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    await verifyAs(world.w.ops.a, terminal, await assertion(terminal, 1));
    await withOwner((db) => terminal.setStatus(db, 'REVOKED'));
    await refusedWith(
      verifyAs(world.w.ops.a, terminal, await assertion(terminal, 2)),
      /appareil refusé/,
    );
    expect(await counterOf(terminal.deviceId)).toBe(1);
  });

  it('appareil Android (aucune clé) : refusé', async () => {
    const { TestTerminal } = await import('../../support/test-terminal');
    const android = await world.enroll(new TestTerminal('ANDROID'));
    const ios = await world.enroll(new IosTestTerminal());
    const raw = await assertion(ios, 1);
    const tx = await openTenantClient(world.w.ops.a);
    await refusedWith(
      verifier.verify(
        { deviceId: android.deviceId, assertion: raw, clientDataHash: REQUEST },
        tx.client,
      ),
      /sans clé App Attest/,
    );
    await tx.rollback();
  });

  describe('droits du rôle applicatif', () => {
    it('ni INSERT, ni UPDATE, ni DELETE directs sur device_app_attest_key (42501)', async () => {
      const terminal = await world.enroll(new IosTestTerminal());
      const tx = await openTenantClient(world.w.ops.a);
      // Contrôle positif : la lecture sous RLS fonctionne.
      const read = await tx.client.query(
        'SELECT 1 FROM device_app_attest_key WHERE device_id = $1',
        [terminal.deviceId],
      );
      expect(read.rowCount).toBe(1);
      await tx.rollback();
      const statements = [
        `UPDATE device_app_attest_key SET counter = 99 WHERE device_id = $1`,
        `DELETE FROM device_app_attest_key WHERE device_id = $1`,
        `INSERT INTO device_app_attest_key (device_id, operator_id, key_id, public_key)
           VALUES ($1, '${world.w.ops.a}', decode(repeat('ab', 32), 'hex'), '\\x00')`,
      ];
      for (const sql of statements) {
        const client = await connect(APP_URL);
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.operator_id', $1, true)", [world.w.ops.a]);
        await expect(client.query(sql, [terminal.deviceId])).rejects.toMatchObject({
          code: '42501',
        });
        await client.query('ROLLBACK');
        await client.end();
      }
      expect(await counterOf(terminal.deviceId)).toBe(0);
    });

    it('EXECUTE : advance_app_attest_counter à cashless_app seul, jamais à PUBLIC', async () => {
      const [row] = await ownerRows<{ app: boolean; platform: boolean; public_acl: boolean }>(
        `SELECT has_function_privilege('cashless_app',
                  'advance_app_attest_counter(uuid, bytea, bigint)', 'EXECUTE') AS app,
                has_function_privilege('cashless_platform',
                  'advance_app_attest_counter(uuid, bytea, bigint)', 'EXECUTE') AS platform,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.proname = 'advance_app_attest_counter' AND a.grantee = 0)
                  AS public_acl`,
      );
      expect(row).toEqual({ app: true, platform: false, public_acl: false });
      // Une seule version d'enroll_device (15 arguments) : l'ancienne n'existe plus.
      const versions = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'enroll_device'`,
      );
      expect(versions[0]!.n).toBe(1);
    });
  });
});
