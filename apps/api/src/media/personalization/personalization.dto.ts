// Poste de personnalisation (contracts/openapi-additions.md) : forme de la demande d'enregistrement d'un bracelet.
// Le poste n'envoie jamais l'identité de la puce, seulement son empreinte ; il fournit une clé publique à usage unique
// pour laquelle le mot de passe sera chiffré.
import { createECDH, createHash } from 'node:crypto';
import { P256_PUBLIC_KEY_LENGTH } from '@cashless/tag-format';
import { invalid, isUuid, objectBody } from '../../organization/platform/platform.dto';

export interface PersonalizationInput {
  batchId: string;
  tokenHash: Buffer;
  uid: Buffer;
  /** SHA-256 de la signature d'originalité : seule cette empreinte est gardée (ADR-59). */
  signatureSha256: Buffer;
  signatureOk: boolean;
  stationPublicKey: Buffer;
}

const TOKEN_HASH = /^[0-9a-fA-F]{64}$/;
const UID = /^[0-9a-f]{14}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Signature d'originalité NXP : 32 octets (NTAG21x, Ultralight EV1) ou 48 ; bornes larges, jamais vide. */
const SIGNATURE_BYTES = { min: 16, max: 128 };

export function parsePersonalization(raw: unknown): PersonalizationInput {
  const body = objectBody(raw);
  if (!isUuid(body.batch_id)) throw invalid('batch_id : identifiant attendu.');
  if (typeof body.token_hash !== 'string' || !TOKEN_HASH.test(body.token_hash))
    throw invalid('token_hash : 64 chiffres hexadécimaux attendus.');
  if (typeof body.nfc_uid !== 'string' || !UID.test(body.nfc_uid))
    throw invalid('nfc_uid : 14 chiffres hexadécimaux en minuscules attendus.');
  if (typeof body.signature_ok !== 'boolean') throw invalid('signature_ok : booléen attendu.');
  const signature =
    typeof body.originality_signature === 'string' && BASE64.test(body.originality_signature)
      ? Buffer.from(body.originality_signature, 'base64')
      : null;
  if (
    !signature ||
    signature.length < SIGNATURE_BYTES.min ||
    signature.length > SIGNATURE_BYTES.max
  ) {
    throw invalid(
      `originality_signature : ${SIGNATURE_BYTES.min} à ${SIGNATURE_BYTES.max} octets en base64 attendus.`,
    );
  }
  return {
    batchId: body.batch_id,
    tokenHash: Buffer.from(body.token_hash, 'hex'),
    uid: Buffer.from(body.nfc_uid, 'hex'),
    signatureSha256: createHash('sha256').update(signature).digest(),
    signatureOk: body.signature_ok,
    stationPublicKey: stationPublicKey(body.station_public_key),
  };
}

/** Clé publique du poste : point P-256 non compressé, vérifié sur la courbe avant tout calcul de mot de passe. */
function stationPublicKey(value: unknown): Buffer {
  const key =
    typeof value === 'string' && BASE64URL.test(value) ? Buffer.from(value, 'base64url') : null;
  if (key && key.length === P256_PUBLIC_KEY_LENGTH && key[0] === 0x04) {
    try {
      const probe = createECDH('prime256v1');
      probe.generateKeys();
      probe.computeSecret(key).fill(0);
      return key;
    } catch {
      // point hors de la courbe : refusé ci-dessous
    }
  }
  throw invalid(
    'station_public_key : clé publique P-256 attendue (point non compressé de 65 octets, base64url).',
  );
}

/** Empreinte de la demande pour l'idempotence : ce qui désigne la puce, pas la clé du poste (elle change à chaque envoi). */
export function personalizationHash(input: PersonalizationInput): string {
  return createHash('sha256')
    .update(input.batchId)
    .update(input.tokenHash)
    .update(input.uid)
    .update(input.signatureSha256)
    .digest('hex');
}

export function parseClaimCode(raw: unknown): string {
  const body = objectBody(raw);
  if (typeof body.claim_code !== 'string' || body.claim_code === '' || body.claim_code.length > 64)
    throw invalid('claim_code : texte de 1 à 64 caractères attendu.');
  return body.claim_code;
}
