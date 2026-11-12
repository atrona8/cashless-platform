// Lecture, dans la copie locale, du terminal et de sa famille de jetons (research R-19). Le jeton
// ne prouve que l'identité et la clé liée : le statut, la clé de signature et l'empreinte du
// certificat sont relus ICI à chaque requête (jamais crus du jeton).
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/gateway-tx';

export type DeviceStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface DeviceRecord {
  deviceId: string;
  serial: string;
  kind: string;
  appMode: string | null;
  status: DeviceStatus;
  posId: string | null;
  /** SPKI DER P-256 ; `null` : terminal sans clé répliquée. */
  publicKey: Buffer | null;
  certSha256: Buffer | null;
}

export interface FamilyRecord {
  fid: string;
  deviceId: string;
  status: string;
  refreshTokenSha256Current: Buffer | null;
}

interface DeviceRow {
  device_id: string;
  serial: string;
  kind: string;
  app_mode: string | null;
  status: DeviceStatus;
  pos_id: string | null;
  public_key: Buffer | null;
  cert_sha256: Buffer | null;
}

const map = (row: DeviceRow): DeviceRecord => ({
  deviceId: row.device_id,
  serial: row.serial,
  kind: row.kind,
  appMode: row.app_mode,
  status: row.status,
  posId: row.pos_id,
  publicKey: row.public_key,
  certSha256: row.cert_sha256,
});

const COLUMNS =
  'device_id, serial, kind, app_mode, status, pos_id, public_key, cert_sha256';

@Injectable()
export class DeviceDirectory {
  async find(tx: TxClient, deviceId: string): Promise<DeviceRecord | null> {
    const { rows } = await tx.query<DeviceRow>(
      `SELECT ${COLUMNS} FROM edge_device WHERE device_id = $1`,
      [deviceId],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async findBySerial(tx: TxClient, serial: string): Promise<DeviceRecord | null> {
    const { rows } = await tx.query<DeviceRow>(
      `SELECT ${COLUMNS} FROM edge_device WHERE serial = $1`,
      [serial],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async family(tx: TxClient, fid: string): Promise<FamilyRecord | null> {
    const { rows } = await tx.query<{
      fid: string;
      device_id: string;
      status: string;
      refresh_token_sha256_current: Buffer | null;
    }>(
      `SELECT fid, device_id, status, refresh_token_sha256_current
         FROM edge_device_token_family WHERE fid = $1`,
      [fid],
    );
    const row = rows[0];
    return row
      ? {
          fid: row.fid,
          deviceId: row.device_id,
          status: row.status,
          refreshTokenSha256Current: row.refresh_token_sha256_current,
        }
      : null;
  }

  /** Familles vivantes du terminal (jeton de rafraîchissement courant connu). */
  async activeFamilies(tx: TxClient, deviceId: string): Promise<FamilyRecord[]> {
    const { rows } = await tx.query<{
      fid: string;
      device_id: string;
      status: string;
      refresh_token_sha256_current: Buffer | null;
    }>(
      `SELECT fid, device_id, status, refresh_token_sha256_current
         FROM edge_device_token_family
        WHERE device_id = $1 AND status = 'ACTIVE' AND refresh_token_sha256_current IS NOT NULL`,
      [deviceId],
    );
    return rows.map((row) => ({
      fid: row.fid,
      deviceId: row.device_id,
      status: row.status,
      refreshTokenSha256Current: row.refresh_token_sha256_current,
    }));
  }
}
