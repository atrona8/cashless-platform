// Identité du terminal pour l'API publique et le processus des clés de bracelet :
// `RealDeviceIdentity` (mission 5a, lot WP12, OP-N42), et lecture du terminal par le rôle de base
// du processus qui sert la route (cashless_app ou cashless_tagkeys, droits de post-roles.sql) :
// chaque processus a sa propre lecture, sous son rôle. Le faux (en-têtes de test) ne se construit
// que hors production ET sur demande explicite (`DEVICE_IDENTITY_FAKE=1`, tests en clair de la
// mission 4) ; en production, la variable posée fait refuser le démarrage, comme tout faux
// (NFR-001, NFR-010).
import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TenantTx } from '../db/tenant-tx';
import { DeviceTokenService } from '../device-tokens/device-token.service';
import { DeviceTokensModule } from '../device-tokens/device-tokens.module';
import { FakeInProductionError } from '../kms/production-guard';
import { DeviceGuard } from './device.guard';
import {
  DEVICE_DIRECTORY,
  DEVICE_IDENTITY,
  type DeviceDirectory,
  type DeviceIdentityPort,
  type DeviceRecord,
} from './device-identity.port';
import { FakeDeviceIdentity } from './fake-device-identity';
import { NonceStore } from './nonce-store';
import { RealDeviceIdentity, type RealDeviceIdentityDeps } from './real-device-identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeviceRow {
  id: string;
  operator_id: string;
  event_id: string | null;
  pos_id: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  agreement_public_key: Buffer | null;
  public_key: Buffer | null;
  cert_sha256: Buffer | null;
  os: 'ANDROID' | 'IOS';
  nfc_enabled: boolean;
}

/** Colonnes lisibles par cashless_app et cashless_tagkeys (post-roles.sql, section 2a). */
export const DEVICE_QUERY = `SELECT id, operator_id, event_id, pos_id, status, agreement_public_key,
        public_key, cert_sha256, os, nfc_enabled
   FROM device WHERE id = $1 AND operator_id = $2`;

export function deviceFromRow(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.id,
    operatorId: row.operator_id,
    eventId: row.event_id,
    posId: row.pos_id,
    status: row.status,
    agreementPublicKey: row.agreement_public_key,
    publicKey: row.public_key,
    certSha256: row.cert_sha256,
    os: row.os,
    nfcEnabled: row.nfc_enabled,
  };
}

@Injectable()
export class TenantDeviceDirectory implements DeviceDirectory {
  constructor(private readonly tx: TenantTx) {}

  find(operatorId: string, deviceId: string): Promise<DeviceRecord | null> {
    if (!UUID.test(operatorId) || !UUID.test(deviceId)) return Promise.resolve(null);
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<DeviceRow>(DEVICE_QUERY, [deviceId, operatorId]);
      return rows[0] ? deviceFromRow(rows[0]) : null;
    });
  }

  /**
   * Terminal et famille `fid` dans une transaction sous le prestataire annoncé : `TenantTx` pose
   * `app.operator_id` AVANT `device_token_family_active`, qui rend faux sans prestataire de
   * session.
   */
  findForAuthentication(operatorId: string, deviceId: string, familyId: string) {
    if (!UUID.test(operatorId) || !UUID.test(deviceId) || !UUID.test(familyId))
      return Promise.resolve(null);
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<DeviceRow>(DEVICE_QUERY, [deviceId, operatorId]);
      if (!rows[0]) return null;
      const family = await client.query<{ active: boolean }>(
        'SELECT device_token_family_active($1, $2) AS active',
        [deviceId, familyId],
      );
      return { device: deviceFromRow(rows[0]), familyActive: family.rows[0]?.active === true };
    });
  }
}

/** Variable qui demande le faux, hors production seulement. */
export const DEVICE_IDENTITY_FAKE_VARIABLE = 'DEVICE_IDENTITY_FAKE';

/**
 * Identité réelle par défaut. Faux seulement si `DEVICE_IDENTITY_FAKE=1` hors production ; la
 * variable posée en production fait refuser le démarrage, toute autre valeur est refusée.
 */
export function createDeviceIdentity(
  config: Pick<AppConfig, 'production' | 'deviceRequestAuthorities'>,
  deps: Omit<RealDeviceIdentityDeps, 'authorities' | 'now'>,
  env: NodeJS.ProcessEnv = process.env,
): DeviceIdentityPort {
  const fake = env[DEVICE_IDENTITY_FAKE_VARIABLE];
  if (fake !== undefined && fake !== '') {
    if (config.production) throw new FakeInProductionError(['l’identité du terminal']);
    if (fake !== '1')
      throw new Error(`${DEVICE_IDENTITY_FAKE_VARIABLE} : « 1 » ou absent (reçu « ${fake} »)`);
    return new FakeDeviceIdentity();
  }
  return new RealDeviceIdentity({ ...deps, authorities: config.deviceRequestAuthorities });
}

@Global()
@Module({
  imports: [DeviceTokensModule],
  providers: [
    NonceStore,
    { provide: DEVICE_DIRECTORY, useClass: TenantDeviceDirectory },
    {
      provide: DEVICE_IDENTITY,
      inject: [APP_CONFIG, DeviceTokenService, DEVICE_DIRECTORY, NonceStore],
      useFactory: (
        config: AppConfig,
        tokens: DeviceTokenService,
        directory: DeviceDirectory,
        nonces: NonceStore,
      ) => createDeviceIdentity(config, { tokens, directory, nonces }),
    },
    DeviceGuard,
  ],
  exports: [DEVICE_IDENTITY, DEVICE_DIRECTORY, DeviceGuard],
})
export class DeviceIdentityModule {}
