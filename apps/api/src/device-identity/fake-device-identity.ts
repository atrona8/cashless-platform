// FAUX fournisseur d'identité du terminal : croit les en-têtes `X-Test-Device-Id` et `X-Test-Operator-Id`.
// N'importe qui peut donc se dire terminal : JAMAIS en production (`createDeviceIdentity` refuse de le construire,
// la garde de production refuse de démarrer). Remplacé par la mission des terminaux.
import type { Request } from 'express';
import type { DeviceClaims, DeviceIdentityPort } from './device-identity.port';

export const TEST_DEVICE_HEADER = 'x-test-device-id';
export const TEST_DEVICE_OPERATOR_HEADER = 'x-test-operator-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FakeDeviceIdentity implements DeviceIdentityPort {
  readonly isFake = true;

  async identify(req: Request): Promise<DeviceClaims | null> {
    const deviceId = req.header(TEST_DEVICE_HEADER);
    const operatorId = req.header(TEST_DEVICE_OPERATOR_HEADER);
    if (!deviceId || !operatorId || !UUID.test(deviceId) || !UUID.test(operatorId)) return null;
    return { deviceId: deviceId.toLowerCase(), operatorId: operatorId.toLowerCase() };
  }
}
