// Terminal de test (mission bracelets-nfc) : une ligne `device` réelle (register_tap la vérifie), une paire de clés
// d'accord ECDH P-256, et les en-têtes que lit le faux fournisseur d'identité. Sait ouvrir l'enveloppe d'un mot de passe.
// Mission 5a (lot WP12) : un terminal affecté à un événement et doté d'une clé d'accord est ENRÔLÉ
// par les fonctions de la base (`enroll_device`, `set_device_status` : test-terminal.ts), plus par
// un INSERT direct. Les deux cas que l'enrôlement ne peut pas produire (terminal sans événement,
// terminal sans clé d'accord) restent des terminaux « d'avant l'enrôlement » (sans clé de signature
// ni certificat), insérés en propriétaire comme avant : l'identité réelle les refuse (étape 3),
// seul le faux de la mission 4 les sert. Interface inchangée.
import 'reflect-metadata';
import { createECDH, randomUUID } from 'node:crypto';
import { deviceAad, openForRecipient, type EncryptedBlob } from '@cashless/tag-format';
import type { Client } from 'pg';
import type { DeviceCaPort } from '../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../src/device-ca/fake-device-ca';
import {
  TEST_DEVICE_HEADER,
  TEST_DEVICE_OPERATOR_HEADER,
} from '../../src/device-identity/fake-device-identity';
import { TestTerminal } from './test-terminal';

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
  /** Terminal enrôlé (clés, certificat, famille) ; absent : terminal d'avant l'enrôlement. */
  terminal?: TestTerminal;
}

let memoryCa: Promise<DeviceCaPort> | null = null;

const headersOf = (deviceId: string, operatorId: string) => ({
  [TEST_DEVICE_HEADER]: deviceId,
  [TEST_DEVICE_OPERATOR_HEADER]: operatorId,
});

/** À appeler avec une connexion propriétaire (`withOwner`). */
export async function createTestDevice(db: Client, input: TestDeviceInput): Promise<TestDevice> {
  if (input.eventId && input.withAgreementKey !== false) {
    memoryCa ??= FakeDeviceCa.inMemory();
    const terminal = await new TestTerminal('ANDROID').enroll(db, {
      operatorId: input.operatorId,
      eventId: input.eventId,
      posId: input.posId ?? null,
      mode: input.kind === 'TOPUP' ? 'TOPUP_DESK' : undefined,
      status: input.status,
      ca: await memoryCa,
    });
    return {
      deviceId: terminal.deviceId,
      operatorId: input.operatorId,
      serial: terminal.serial,
      headers: headersOf(terminal.deviceId, input.operatorId),
      open: (blob, uid) => terminal.open(blob, uid),
      terminal,
    };
  }
  // Terminal d'avant l'enrôlement : ni clé de signature, ni certificat, ni attestation.
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
    headers: headersOf(deviceId, input.operatorId),
    open: (blob, uid) =>
      openForRecipient({ recipientPrivateKey: privateKey, blob, aad: deviceAad(deviceId, uid) }),
  };
}
