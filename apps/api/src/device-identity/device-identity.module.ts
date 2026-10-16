// Identité du terminal pour l'API publique : faux fournisseur (hors production) et lecture du terminal par le rôle
// applicatif. Le processus des clés de bracelet fournit sa propre lecture (son rôle de base n'est pas le même).
import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx } from '../db/tenant-tx';
import { FakeInProductionError } from '../kms/production-guard';
import { DeviceGuard } from './device.guard';
import { DEVICE_DIRECTORY, DEVICE_IDENTITY, type DeviceDirectory } from './device-identity.port';
import { FakeDeviceIdentity } from './fake-device-identity';

export interface DeviceRow {
  id: string;
  operator_id: string;
  event_id: string | null;
  pos_id: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  agreement_public_key: Buffer | null;
}

export const DEVICE_QUERY =
  'SELECT id, operator_id, event_id, pos_id, status, agreement_public_key FROM device WHERE id = $1 AND operator_id = $2';

export function deviceFromRow(row: DeviceRow) {
  return {
    deviceId: row.id,
    operatorId: row.operator_id,
    eventId: row.event_id,
    posId: row.pos_id,
    status: row.status,
    agreementPublicKey: row.agreement_public_key,
  };
}

@Injectable()
export class TenantDeviceDirectory implements DeviceDirectory {
  constructor(private readonly tx: TenantTx) {}

  find(operatorId: string, deviceId: string) {
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<DeviceRow>(DEVICE_QUERY, [deviceId, operatorId]);
      return rows[0] ? deviceFromRow(rows[0]) : null;
    });
  }
}

export function createDeviceIdentity(config: Pick<AppConfig, 'production'>): FakeDeviceIdentity {
  if (config.production) throw new FakeInProductionError(['l’identité du terminal']);
  return new FakeDeviceIdentity();
}

@Global()
@Module({
  providers: [
    { provide: DEVICE_IDENTITY, inject: [APP_CONFIG], useFactory: createDeviceIdentity },
    { provide: DEVICE_DIRECTORY, useClass: TenantDeviceDirectory },
    DeviceGuard,
  ],
  exports: [DEVICE_IDENTITY, DEVICE_DIRECTORY, DeviceGuard],
})
export class DeviceIdentityModule {}
