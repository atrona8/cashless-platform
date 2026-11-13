// deviceKey / MAX_DEVICE_SEQ = 2^53 − 1 (R-14) et absence de Number(seq) dans les fichiers du lot.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceContext } from '../../../src/device-identity/device-identity.port';
import { deviceKey, MAX_DEVICE_SEQ, parseDeviceKey } from '../../../src/idempotency/device-key';

const device = (serial: string): DeviceContext => ({
  deviceId: '00000000-0000-0000-0000-00000000d001',
  operatorId: '00000000-0000-0000-0000-00000000a001',
  eventId: null,
  posId: null,
  agreementPublicKey: null,
  serial,
});

describe('deviceKey', () => {
  it('complète à gauche jusqu’à 4 chiffres, ne tronque jamais', () => {
    expect(deviceKey('SN-1', 87n)).toBe('SN-1:0087');
    expect(deviceKey('SN-1', 1000n)).toBe('SN-1:1000');
    expect(deviceKey('SN-1', 12345n)).toBe('SN-1:12345');
  });

  it('borne : 2^53 − 1 accepté, 2^53, 0 et négatifs refusés', () => {
    expect(MAX_DEVICE_SEQ).toBe(9007199254740991n);
    expect(deviceKey('SN-1', MAX_DEVICE_SEQ)).toBe('SN-1:9007199254740991');
    expect(() => deviceKey('SN-1', 9007199254740992n)).toThrow();
    expect(() => deviceKey('SN-1', 0n)).toThrow();
    expect(() => deviceKey('SN-1', -5n)).toThrow();
  });

  it.each([87n, 1000n, 12345n, 9007199254740991n])(
    'aller-retour avec parseDeviceKey : %s',
    (seq) => {
      expect(parseDeviceKey(deviceKey('SN-1', seq), device('SN-1'))).toBe(seq);
    },
  );

  it('serial contenant « : » : le dernier « : » sépare', () => {
    expect(parseDeviceKey(deviceKey('AB:CD', 42n), device('AB:CD'))).toBe(42n);
  });

  it('parseDeviceKey refuse 2^53 en 422 VALIDATION_FAILED', () => {
    expect(() => parseDeviceKey('SN-1:9007199254740992', device('SN-1'))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', status: 422 }),
    );
  });
});

describe('plus de Number(seq) dans les fichiers du lot', () => {
  const root = join(__dirname, '../../../src');
  it.each([
    'payments/device-seq-registry.ts',
    'idempotency/device-key.ts',
    'topups/cash/cash-topup.service.ts',
    'reversals/reversal.dto.ts',
    'payments/payments.service.ts',
  ])('%s', (file) => {
    expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/Number\((args\.)?seq/);
  });

  it('shared-rules/chained-content.ts (déplacé depuis payments/)', () => {
    const moved = join(root, '../../../packages/shared-rules/src/chained-content.ts');
    expect(readFileSync(moved, 'utf8')).not.toMatch(/Number\((args\.)?seq/);
  });

  it('plus d’INSERT INTO anomaly dans payments.service.ts (CLOCK_SKEW par la fonction)', () => {
    const text = readFileSync(join(root, 'payments/payments.service.ts'), 'utf8');
    expect(text).not.toMatch(/INSERT INTO anomaly/);
    expect(text).toMatch(/openAnomaly\(client/);
  });
});
