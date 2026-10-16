// Lecture d'un bracelet par un terminal (contrat `TapInput`, SPECIFICATION §7.6) et traduction du résultat de
// `register_tap` pour les opérations d'écriture (contracts/media-lifecycle.md).
import type { ProblemCode } from '@cashless/contracts';
import { ProblemException } from '../../errors/problem';
import { dateTimeField, intField, invalid, objectBody, unprocessable } from '../../organization/platform/platform.dto';

export const TAP_RESULTS = [
  'OK', 'UNKNOWN', 'BLOCKED', 'UID_MISMATCH', 'SIGNATURE_MISMATCH', 'SIGNATURE_MISSING', 'CLONE_SUSPECTED', 'RETIRED', 'REPLACED', 'NOT_ACTIVATED', 'RELEASED',
  'BATCH_INACTIVE', 'WRONG_EVENT',
] as const;
export type TapResult = (typeof TAP_RESULTS)[number];

/** Résultats dont les effets (liste noire, anomalie) doivent survivre à l'échec de l'opération qui portait la lecture. */
export const DURABLE_RESULTS: readonly TapResult[] = ['UID_MISMATCH', 'SIGNATURE_MISMATCH', 'CLONE_SUSPECTED'];

const PROBLEMS: Record<Exclude<TapResult, 'OK'>, ProblemCode> = {
  UNKNOWN: 'MEDIA_UNKNOWN',
  BLOCKED: 'MEDIA_BLOCKED',
  UID_MISMATCH: 'MEDIA_UID_MISMATCH',
  SIGNATURE_MISMATCH: 'MEDIA_SIGNATURE_MISMATCH',
  SIGNATURE_MISSING: 'MEDIA_SIGNATURE_MISSING',
  CLONE_SUSPECTED: 'MEDIA_CLONE_SUSPECTED',
  RETIRED: 'MEDIA_RETIRED',
  REPLACED: 'MEDIA_REPLACED',
  NOT_ACTIVATED: 'MEDIA_NOT_ACTIVATED',
  RELEASED: 'MEDIA_RELEASED',
  BATCH_INACTIVE: 'MEDIA_BATCH_INACTIVE',
  WRONG_EVENT: 'MEDIA_WRONG_EVENT',
};

/** Erreur d'une opération d'écriture dont la lecture n'a pas donné un résultat admis. */
export function tapProblem(result: Exclude<TapResult, 'OK'>): ProblemException {
  return new ProblemException(PROBLEMS[result]);
}

export interface TapInput {
  uid: Buffer;
  tokenHash: Buffer;
  counter: number;
  keyIndex: number;
  signature: Buffer | null;
  occurredAt: Date;
}

const UID = /^[0-9a-f]{14}$/;
const HEX32 = /^[0-9a-f]{64}$/;

export function parseTap(raw: unknown): TapInput {
  const body = objectBody(raw);
  if (typeof body.nfc_uid !== 'string' || !UID.test(body.nfc_uid)) throw invalid('nfc_uid : 14 chiffres hexadécimaux en minuscules attendus.');
  if (typeof body.token_hash !== 'string' || !HEX32.test(body.token_hash)) throw invalid('token_hash : 64 chiffres hexadécimaux en minuscules attendus.');
  if (typeof body.pack_verified !== 'boolean') throw invalid('pack_verified : booléen attendu.');
  if (body.originality_signature !== undefined && (typeof body.originality_signature !== 'string' || !HEX32.test(body.originality_signature))) {
    throw invalid('originality_signature : 64 chiffres hexadécimaux en minuscules attendus.');
  }
  const input: TapInput = {
    uid: Buffer.from(body.nfc_uid, 'hex'),
    tokenHash: Buffer.from(body.token_hash, 'hex'),
    counter: intField(body, 'counter', 0, 16_777_215, 'required')!,
    keyIndex: intField(body, 'key_index', 0, 65535, 'required')!,
    signature: typeof body.originality_signature === 'string' ? Buffer.from(body.originality_signature, 'hex') : null,
    occurredAt: dateTimeField(body, 'occurred_at', 'required')!,
  };
  const major = intField(body, 'format_major', 0, 255, 'optional') ?? 1;
  intField(body, 'format_minor', 0, 255, 'optional');
  // Un majeur inconnu n'est pas lisible par cette version (format B, §6.1) ; une puce qui n'a pas rendu le bon PACK
  // ne s'est pas authentifiée : sa lecture ne vaut rien et n'est pas enregistrée.
  if (major !== 1) throw unprocessable(`format_major : version ${major} du format inconnue de ce serveur.`);
  if (!body.pack_verified) throw unprocessable('pack_verified : la puce ne s’est pas authentifiée (PACK non vérifié) ; lecture refusée.');
  return input;
}
