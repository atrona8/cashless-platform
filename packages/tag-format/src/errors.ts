// Refus de la bibliothèque de format : un code stable, identique en TypeScript et en Dart.
export type TagFormatErrorCode =
  | 'BAD_LENGTH'
  | 'UNKNOWN_MAJOR'
  | 'BAD_CRC'
  | 'BAD_KEY_INDEX'
  | 'BAD_IDENTITY'
  | 'BAD_UUID'
  | 'BAD_UID'
  | 'BAD_KEY'
  | 'AUTH_FAILED'
  | 'BAD_CLAIM_CODE';

export class TagFormatError extends Error {
  constructor(
    readonly code: TagFormatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TagFormatError';
  }
}

export function requireLength(
  bytes: Uint8Array,
  length: number,
  code: TagFormatErrorCode,
  what: string,
): void {
  if (bytes.length !== length)
    throw new TagFormatError(code, `${what} : ${length} octets attendus, ${bytes.length} reçus`);
}
