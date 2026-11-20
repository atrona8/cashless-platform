// Enrôlement et clé App Attest (WP13, T049) : un iPhone enrôlé par la route garde sa clé attestée
// et son identifiant (`device_app_attest_key`), un Android n'en garde aucune, une même attestation
// rejouée est refusée, l'audit ne porte que l'identifiant en hexadécimal. Faux (hors production) :
// l'enrôlement reste possible, sans clé.
import 'reflect-metadata';
import { ownerRows } from '../../support/media-fixtures';
import { sha256, rawPoint, spki } from '../../support/attestation/ios';
import { TestTerminal } from '../../support/test-terminal';
import { IosTestTerminal, startAttestationWorld, type AttestationWorld } from './app-attest-world';

interface KeyRow {
  device_id: string;
  operator_id: string;
  key_id: Buffer;
  public_key: Buffer;
  counter: string | bigint;
}
const keyRows = (deviceId: string) =>
  ownerRows<KeyRow>('SELECT * FROM device_app_attest_key WHERE device_id = $1', [deviceId]);

describe('enrôlement : clé App Attest gardée (WP13, T049)', () => {
  let world: AttestationWorld;
  beforeAll(async () => {
    world = await startAttestationWorld(true);
  }, 60_000);
  afterAll(async () => {
    await world?.close();
  });

  it('iOS : une ligne, key_id = SHA-256 du point, compteur 0, prestataire du code', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    const [row, ...others] = await keyRows(terminal.deviceId);
    expect(others).toEqual([]);
    expect(row!.key_id.equals(sha256(await rawPoint(terminal.appAttestKeys.publicKey)))).toBe(true);
    expect(row!.public_key.equals(await spki(terminal.appAttestKeys.publicKey))).toBe(true);
    expect(Number(row!.counter)).toBe(0);
    expect(row!.operator_id).toBe(world.w.ops.a);
    // La clé de signature du terminal n'est PAS la clé App Attest.
    const [device] = await ownerRows<{ public_key: Buffer }>(
      'SELECT public_key FROM device WHERE id = $1',
      [terminal.deviceId],
    );
    expect(device!.public_key.equals(row!.public_key)).toBe(false);
  });

  it('Android : aucune ligne ; contrôle positif : l’enrôlement a bien eu lieu', async () => {
    const terminal = await world.enroll(new TestTerminal('ANDROID'));
    const [device] = await ownerRows<{ id: string }>('SELECT id FROM device WHERE id = $1', [
      terminal.deviceId,
    ]);
    expect(device!.id).toBe(terminal.deviceId);
    expect(await keyRows(terminal.deviceId)).toEqual([]);
  });

  it('la même clé attestée rejouée (autre serial) : refusée, rien d’enrôlé', async () => {
    const first = await world.enroll(new IosTestTerminal());
    const replay = new IosTestTerminal();
    // Même clé App Attest que le premier terminal : key_id unique.
    replay.iosAttestation = async (code, pki) => {
      const { appAttestObject } = await import('../../support/attestation/ios');
      const { iosClientDataHash } = await import('../../../src/attestation/enrollment-challenge');
      replay.appAttestKeys = first.appAttestKeys;
      return {
        keyChain: [
          await appAttestObject({
            publicKey: first.appAttestKeys.publicKey,
            clientDataHash: iosClientDataHash(
              code,
              replay.serial,
              replay.signing.spki,
              replay.agreement.spki,
            ),
            pki: pki!,
          }),
        ],
        pki: pki!,
      };
    };
    const res = await world.enrollRaw(replay);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ATTESTATION_FAILED');
    const devices = await ownerRows('SELECT 1 FROM device WHERE serial = $1', [replay.serial]);
    expect(devices).toEqual([]);
    expect(await keyRows(first.deviceId)).toHaveLength(1);
  });

  it('audit DEVICE_ENROLLED : app_attest_key_id en hex, jamais la clé ni le compteur', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    const [row] = await keyRows(terminal.deviceId);
    const [audit] = await ownerRows<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_log WHERE action = 'DEVICE_ENROLLED' AND object_id = $1`,
      [terminal.deviceId],
    );
    expect(audit!.after.app_attest_key_id).toBe(row!.key_id.toString('hex'));
    const text = JSON.stringify(audit!.after);
    expect(text).not.toContain(row!.public_key.toString('hex'));
    expect(text).not.toContain(row!.public_key.toString('base64'));
    expect(Object.keys(audit!.after).filter((key) => /counter|public/.test(key))).toEqual([]);
    const android = await world.enroll(new TestTerminal('ANDROID'));
    const [androidAudit] = await ownerRows<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_log WHERE action = 'DEVICE_ENROLLED' AND object_id = $1`,
      [android.deviceId],
    );
    expect(androidAudit!.after).not.toHaveProperty('app_attest_key_id');
  });
});

describe('enrôlement avec le faux d’attestation (hors production)', () => {
  let world: AttestationWorld;
  beforeAll(async () => {
    world = await startAttestationWorld(false);
  }, 60_000);
  afterAll(async () => {
    await world?.close();
  });

  it('iOS enrôlé sans clé App Attest (valeur NULL par défaut)', async () => {
    const terminal = await world.enroll(new IosTestTerminal());
    const [device] = await ownerRows<{ id: string }>('SELECT id FROM device WHERE id = $1', [
      terminal.deviceId,
    ]);
    expect(device!.id).toBe(terminal.deviceId);
    expect(await keyRows(terminal.deviceId)).toEqual([]);
  });
});
