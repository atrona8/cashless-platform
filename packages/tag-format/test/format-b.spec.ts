// Format B 1.0 et CRC : vecteurs du kit (vecteurs_test_bracelet.py, SPECIFICATION §7.2) et refus.
import { TagFormatError, crc32IsoHdlc, decodeFormatB, encodeFormatB, tokenHash } from '../src';
import { hex, vectors } from './vectors';

const v = vectors.format_b;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof TagFormatError ? error.code : `autre: ${String(error)}`;
  }
  return undefined;
}

describe('format B 1.0', () => {
  it('CRC-32/ISO-HDLC : valeur de contrôle', () => {
    expect(crc32IsoHdlc(Buffer.from(vectors.crc_check.input_ascii, 'ascii')).toString('hex')).toBe(
      vectors.crc_check.crc,
    );
  });

  it('encode le vecteur du kit à l’octet près', () => {
    const bytes = encodeFormatB({ keyIndex: v.key_index, identity: hex(v.identity) });
    expect(bytes.toString('hex')).toBe(v.bytes);
    expect(bytes.subarray(24).toString('hex')).toBe(v.crc);
  });

  it('décode le vecteur du kit', () => {
    expect(decodeFormatB(hex(v.bytes))).toEqual({
      major: v.major,
      minor: v.minor,
      keyIndex: v.key_index,
      identity: hex(v.identity),
      flags: v.flags,
    });
  });

  it.each(vectors.refusals.format_b as { name: string; bytes: string; code: string }[])(
    'refuse : $name',
    (refusal) => {
      expect(codeOf(() => decodeFormatB(hex(refusal.bytes)))).toBe(refusal.code);
    },
  );

  it('accepte un mineur plus récent et des octets réservés non nuls', () => {
    const bytes = hex(v.bytes);
    bytes[1] = 7;
    bytes[22] = 0xaa;
    crc32IsoHdlc(bytes.subarray(0, 24)).copy(bytes, 24);
    expect(decodeFormatB(bytes)).toMatchObject({ major: 1, minor: 7, keyIndex: v.key_index });
  });

  it('refuse un index de clé ou une identité hors bornes', () => {
    expect(codeOf(() => encodeFormatB({ keyIndex: 65536, identity: hex(v.identity) }))).toBe(
      'BAD_KEY_INDEX',
    );
    expect(codeOf(() => encodeFormatB({ keyIndex: -1, identity: hex(v.identity) }))).toBe(
      'BAD_KEY_INDEX',
    );
    expect(codeOf(() => encodeFormatB({ keyIndex: 1.5, identity: hex(v.identity) }))).toBe(
      'BAD_KEY_INDEX',
    );
    expect(codeOf(() => encodeFormatB({ keyIndex: 1, identity: Buffer.alloc(15) }))).toBe(
      'BAD_IDENTITY',
    );
  });

  it('aller-retour sur les bornes de l’index', () => {
    for (const keyIndex of [0, 1, 255, 256, 65535]) {
      expect(decodeFormatB(encodeFormatB({ keyIndex, identity: hex(v.identity) })).keyIndex).toBe(
        keyIndex,
      );
    }
  });

  it('empreinte de l’identité : SHA-256, 32 octets', () => {
    expect(tokenHash(hex(v.identity)).length).toBe(32);
    expect(codeOf(() => tokenHash(Buffer.alloc(17)))).toBe('BAD_IDENTITY');
  });
});
