// Terminal de test (mission bracelets-nfc) : une ligne `device` réelle (register_tap la vérifie), une paire de clés
// d'accord ECDH P-256, et les en-têtes que lit le faux fournisseur d'identité. Sait ouvrir l'enveloppe d'un mot de passe.
import { createECDH, randomUUID } from 'node:crypto';
import { deviceAad, openForRecipient, type EncryptedBlob } from '@cashless/tag-format';
import type { Client } from 'pg';
import {
  TEST_DEVICE_HEADER,
  TEST_DEVICE_OPERATOR_HEADER,
} from '../../src/device-identity/fake-device-identity';

export interface TestDeviceInput {
  operatorId: string;
  eventId?: string | null;
  posId?: string | null;
  status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  kind?: 'POS' | 'TOPUP';
  /** `false` : terminal sans clé d'accord (pour tester le refus). */
  withAgreementKey?: boolean;
}

export interface TestDevice {
  deviceId: string;
  operatorId: string;
  serial: string;
  headers: Record<string, string>;
  /** Ouvre l'enveloppe de `POST /media/auth-keys` : rend `PWD‖PACK`. */
  open(blob: EncryptedBlob, uid: Uint8Array): Buffer;
}

/** À appeler avec une connexion propriétaire (`withOwner`). */
export async function createTestDevice(db: Client, input: TestDeviceInput): Promise<TestDevice> {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const deviceId = randomUUID();
  const serial = `TEST-${deviceId.slice(0, 8)}`;
  await db.query(
    `INSERT INTO device (id, operator_id, kind, event_id, pos_id, serial, status, agreement_public_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      deviceId,
      input.operatorId,
      input.kind ?? 'POS',
      input.eventId ?? null,
      input.posId ?? null,
      serial,
      input.status ?? 'ACTIVE',
      input.withAgreementKey === false ? null : ecdh.getPublicKey(),
    ],
  );
  const privateKey = ecdh.getPrivateKey();
  return {
    deviceId,
    operatorId: input.operatorId,
    serial,
    headers: { [TEST_DEVICE_HEADER]: deviceId, [TEST_DEVICE_OPERATOR_HEADER]: input.operatorId },
    open: (blob, uid) =>
      openForRecipient({ recipientPrivateKey: privateKey, blob, aad: deviceAad(deviceId, uid) }),
  };
}
