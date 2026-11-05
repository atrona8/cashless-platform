// Entrées de `GET /offline-snapshots/current` et `POST /offline-snapshots/ack` (openapi.yaml :
// getOfflineSnapshot, ackOfflineSnapshot). Les numéros de version restent des `bigint` : jamais de
// `Number(...)` sur un entier de 64 bits.
import { invalid, objectBody, unprocessable } from '../../organization/platform/platform.dto';

const MAX_INT64 = 9223372036854775807n;
const HEX32 = /^[0-9a-fA-F]{64}$/;

/** `since_version` : entier >= 0 en chiffres (int64), absent = sans version ; sinon 400. */
export function parseSinceVersion(raw: unknown): bigint | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^\d{1,19}$/.test(raw))
    throw invalid('since_version : entier positif ou nul en chiffres.');
  const value = BigInt(raw);
  if (value > MAX_INT64) throw invalid('since_version : au plus 9223372036854775807.');
  return value;
}

export interface AckInput {
  version: bigint;
  contentSha256: Buffer;
}

/** Corps de l'accusé : `{version >= 1, content_sha256}` exactement ; champ inconnu : 422. */
export function parseAck(raw: unknown): AckInput {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((k) => k !== 'version' && k !== 'content_sha256');
  if (unknown.length > 0) throw unprocessable('Champ inconnu dans le corps de l’accusé.');
  const { version, content_sha256: sha } = body;
  // Un nombre JSON au-delà de 2^53-1 est déjà arrondi à la lecture : refusé, jamais deviné.
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)
    throw invalid('version : entier de 1 à 9007199254740991.');
  if (typeof sha !== 'string' || !HEX32.test(sha))
    throw invalid('content_sha256 : 64 caractères hexadécimaux.');
  return { version: BigInt(version), contentSha256: Buffer.from(sha, 'hex') };
}
