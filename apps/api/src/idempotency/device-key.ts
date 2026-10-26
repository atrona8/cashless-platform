// Clé d'idempotence d'une route de terminal seul (mission 5b, lot WP08 ; A14, R-03 ;
// contracts/payments.md, « Clé et registre des numéros ») : `Idempotency-Key = <serial>:<seq>`,
// `<serial>` égal au `device.serial` du terminal authentifié (lu en base par la garde), `<seq>` de
// 4 chiffres au moins. Contrôlée AVANT la réservation : un refus n'écrit rien.
// Refus non définitifs (`409 DEBIT_AUTHORITY_MOVING`, `409 DEBIT_AUTHORITY_EDGE`) : la clé est
// relâchée comme sur un 5xx (le terminal rejoue la même clé) ; liste fermée.
import type { ProblemCode } from '@cashless/contracts';
import type { Request } from 'express';
import { requestDevice, type DeviceContext } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';

const DEVICE_KEY = /^(.+):([0-9]{4,})$/;
/** Plus grand `seq` du registre (`bigint` de la base) : au-delà, `record_device_seq` lèverait `22003` (500). */
export const MAX_DEVICE_SEQ = 9223372036854775807n;

/** Portée de la clé d'une route de terminal (même forme que `counterScope`). */
export const deviceScope = (req: Request): string => `device:${requestDevice(req).deviceId}:`;

/** `<seq>` de la clé si `<serial>` est celui du terminal ; sinon `422 VALIDATION_FAILED`. */
export function parseDeviceKey(key: string, device: DeviceContext): bigint {
  const match = DEVICE_KEY.exec(key);
  const seq = match ? BigInt(match[2]!) : 0n;
  if (!match || device.serial === undefined || match[1] !== device.serial || seq > MAX_DEVICE_SEQ)
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'Idempotency-Key : « <serial>:<seq> » attendu, avec le numéro de série du terminal.',
    });
  return seq;
}

/** Refus non définitifs du contrat : ni réponse enregistrée ni numéro consommé (A14). */
export const NON_FINAL_CODES: ReadonlySet<ProblemCode> = new Set<ProblemCode>([
  'DEBIT_AUTHORITY_MOVING',
  'DEBIT_AUTHORITY_EDGE',
]);

/** Requête d'une route `deviceSeq` : `seq` posé par l'intercepteur pour le contrôleur. */
export interface DeviceSeqRequest extends Request {
  deviceSeq?: bigint;
}

/** `seq` de la clé, posé par l'intercepteur (route `@Idempotent({ deviceSeq: true })` seulement). */
export function requestDeviceSeq(req: Request): bigint {
  const seq = (req as DeviceSeqRequest).deviceSeq;
  if (seq === undefined) throw new Error('requestDeviceSeq : route non marquée deviceSeq');
  return seq;
}
