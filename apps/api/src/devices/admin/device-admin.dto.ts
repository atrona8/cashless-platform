// Back-office des terminaux (mission 5a, lot WP16 ; contrat `DeviceAdmin`, `DeviceAdminDetail`,
// `DevicePage`, `DeviceStatusChangeRequest` ; contracts/device-lifecycle.md). Les colonnes lues
// sont nommées une à une : jamais `public_key`, `agreement_public_key`, `cert_sha256` ni jeton
// (FR-017).
import type { components } from '@cashless/contracts';
import { invalid, isUuid, objectBody } from '../../organization/platform/platform.dto';

export type DeviceAdmin = components['schemas']['DeviceAdmin'];
export type DeviceAdminDetail = components['schemas']['DeviceAdminDetail'];
export type DeviceStatusHistoryEntry = components['schemas']['DeviceStatusHistoryEntry'];
export type DeviceStatus = components['schemas']['DeviceStatus'];

export const DEVICE_STATUSES: readonly DeviceStatus[] = ['ACTIVE', 'SUSPENDED', 'REVOKED'];
const APP_MODES: readonly string[] = ['CATALOG_POS', 'KEYPAD_TPE', 'TOPUP_DESK', 'PAIRED_TPE'];

/** Colonnes du terminal servies au back-office (alias `d`), et elles seules. */
export const DEVICE_ADMIN_COLUMNS = `d.id, d.serial, d.kind, d.app_mode, d.os, d.personal_phone,
       d.nfc_enabled, d.provided_by, d.status, d.status_reason, d.event_id, d.pos_id,
       d.station_name, d.app_version, d.attestation_kind, d.attestation_security_level,
       d.enrolled_at, d.last_seen_at, d.cert_not_after`;

export interface DeviceAdminRow {
  id: string;
  serial: string;
  kind: DeviceAdmin['kind'];
  app_mode: DeviceAdmin['app_mode'];
  os: DeviceAdmin['os'];
  personal_phone: boolean;
  nfc_enabled: boolean;
  provided_by: NonNullable<DeviceAdmin['provided_by']>;
  status: DeviceStatus;
  status_reason: string | null;
  event_id: string | null;
  pos_id: string | null;
  station_name: string | null;
  app_version: string | null;
  attestation_kind: DeviceAdmin['attestation_kind'];
  attestation_security_level: DeviceAdmin['attestation_security_level'];
  enrolled_at: Date | null;
  last_seen_at: Date | null;
  cert_not_after: Date | null;
}

export interface DeviceHistoryRow {
  from_status: DeviceStatus | null;
  to_status: DeviceStatus;
  reason: string;
  actor_id: string | null;
  at: Date;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Ligne → `DeviceAdmin` : liste blanche des champs (aucune clé, aucune empreinte). */
export function deviceAdminDto(row: DeviceAdminRow): DeviceAdmin {
  return {
    device_id: row.id,
    serial: row.serial,
    kind: row.kind,
    app_mode: row.app_mode,
    os: row.os,
    personal_phone: row.personal_phone,
    nfc_enabled: row.nfc_enabled,
    provided_by: row.provided_by,
    status: row.status,
    status_reason: row.status_reason,
    event_id: row.event_id,
    pos_id: row.pos_id,
    station_name: row.station_name,
    app_version: row.app_version,
    attestation_kind: row.attestation_kind,
    attestation_security_level: row.attestation_security_level,
    enrolled_at: iso(row.enrolled_at),
    last_seen_at: iso(row.last_seen_at),
    cert_not_after: iso(row.cert_not_after),
  };
}

export function historyDto(row: DeviceHistoryRow): DeviceStatusHistoryEntry {
  return {
    from_status: row.from_status,
    to_status: row.to_status,
    reason: row.reason,
    actor_id: row.actor_id,
    at: row.at.toISOString(),
  };
}

/** Filtres de `listDevices` (400 sur une valeur mal formée). */
export interface DeviceListFilter {
  eventId?: string;
  posId?: string;
  status?: string;
  appMode?: string;
}

export function parseDeviceListFilter(query: Record<string, string | undefined>): DeviceListFilter {
  const { event_id: eventId, pos_id: posId, status, app_mode: appMode } = query;
  if (eventId !== undefined && !isUuid(eventId)) throw invalid('event_id : identifiant attendu.');
  if (posId !== undefined && !isUuid(posId)) throw invalid('pos_id : identifiant attendu.');
  if (status !== undefined && !(DEVICE_STATUSES as readonly string[]).includes(status))
    throw invalid('status : valeur inconnue.');
  if (appMode !== undefined && !APP_MODES.includes(appMode))
    throw invalid('app_mode : valeur inconnue.');
  return { eventId, posId, status, appMode };
}

/** Corps `DeviceStatusChangeRequest` : un motif de 10 à 500 caractères, aucun autre champ. */
export function parseStatusChange(raw: unknown): string {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((key) => key !== 'reason');
  if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
  const reason = body.reason;
  if (reason === undefined) throw invalid('Champ obligatoire : reason.');
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500)
    throw invalid('reason : texte de 10 à 500 caractères.');
  return reason.trim();
}
