// Corps de `POST /v1/device/heartbeat` (openapi.yaml : HeartbeatRequest). Seuls `app_version` et
// `device_time` sont transmis à la base (`record_device_heartbeat`) ; la file locale annoncée
// (`last_local_seq`, `pending_operations`…) est contrôlée mais pas conservée : aucun numéro de
// séquence n'est consommé ni avancé par un battement de cœur (FR-019).
import {
  dateTimeField,
  intField,
  objectBody,
  textField,
} from '../../organization/platform/platform.dto';

/** Borne de `device.app_version` (contrôle de `record_device_heartbeat`). */
const MAX_APP_VERSION = 64;

export interface HeartbeatInput {
  deviceTime: Date;
  appVersion: string | null;
}

export function parseHeartbeat(raw: unknown): HeartbeatInput {
  const body = objectBody(raw);
  const deviceTime = dateTimeField(body, 'device_time', 'required')!;
  intField(body, 'last_local_seq', 0, Number.MAX_SAFE_INTEGER, 'required');
  intField(body, 'pending_operations', 0, Number.MAX_SAFE_INTEGER, 'required');
  if (body.snapshot_version !== null)
    intField(body, 'snapshot_version', 0, Number.MAX_SAFE_INTEGER, 'optional');
  intField(body, 'pending_exposure', 0, Number.MAX_SAFE_INTEGER, 'optional');
  intField(body, 'battery_percent', 0, 100, 'optional');
  const appVersion = textField(body, 'app_version', MAX_APP_VERSION, 'optional') ?? null;
  return { deviceTime, appVersion };
}
