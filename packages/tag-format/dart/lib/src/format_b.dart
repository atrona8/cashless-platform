// Format B, version 1.0 (SPECIFICATION §7.2) : 28 octets, pages 4 à 10 d'une MIFARE Ultralight EV1.
//   0      version majeure (1)        — un majeur inconnu est refusé
//   1      version mineure (0)        — un mineur plus récent est accepté
//   2-3    index de clé, big-endian
//   4-19   identité (16 octets aléatoires)
//   20     drapeaux (0 en 1.0)
//   21-23  réservé (zéros à l'écriture, ignorés à la lecture)
//   24-27  CRC-32/ISO-HDLC des octets 0 à 23, big-endian
import 'dart:typed_data';

import 'package:pointycastle/digests/sha256.dart';

import 'errors.dart';

const int formatBLength = 28;
const int formatBMajor = 1;
const int formatBMinor = 0;
const int identityLength = 16;

class FormatB {
  FormatB({
    required this.major,
    required this.minor,
    required this.keyIndex,
    required this.identity,
    required this.flags,
  });

  final int major;
  final int minor;
  final int keyIndex;
  final Uint8List identity;
  final int flags;
}

final Uint32List _crcTable = _buildCrcTable();

Uint32List _buildCrcTable() {
  final table = Uint32List(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) != 0 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

/// CRC-32/ISO-HDLC (zlib), rendu sur 4 octets big-endian. Contrôle : « 123456789 » → CBF43926.
Uint8List crc32IsoHdlc(List<int> bytes) {
  var crc = 0xFFFFFFFF;
  for (final byte in bytes) {
    crc = _crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xFFFFFFFF) & 0xFFFFFFFF;
  return Uint8List(4)..buffer.asByteData().setUint32(0, crc);
}

void assertKeyIndex(int keyIndex) {
  if (keyIndex < 0 || keyIndex > 65535) {
    throw TagFormatException(
      'BAD_KEY_INDEX',
      'index de clé hors bornes (0 à 65535) : $keyIndex',
    );
  }
}

Uint8List encodeFormatB({required int keyIndex, required List<int> identity}) {
  assertKeyIndex(keyIndex);
  requireLength(identity, identityLength, 'BAD_IDENTITY', 'identité');
  final out = Uint8List(formatBLength);
  out[0] = formatBMajor;
  out[1] = formatBMinor;
  out.buffer.asByteData().setUint16(2, keyIndex);
  out.setRange(4, 20, identity);
  out.setRange(24, 28, crc32IsoHdlc(Uint8List.sublistView(out, 0, 24)));
  return out;
}

FormatB decodeFormatB(List<int> bytes) {
  requireLength(bytes, formatBLength, 'BAD_LENGTH', 'format B');
  final buf = Uint8List.fromList(bytes);
  final major = buf[0];
  // La page 4 est gelée pour toutes les versions : le majeur se lit avant tout contrôle du reste.
  if (major != formatBMajor) {
    throw TagFormatException(
      'UNKNOWN_MAJOR',
      'version majeure inconnue : $major',
    );
  }
  final crc = crc32IsoHdlc(Uint8List.sublistView(buf, 0, 24));
  for (var i = 0; i < 4; i++) {
    if (crc[i] != buf[24 + i]) {
      throw TagFormatException('BAD_CRC', 'CRC du format B incorrect');
    }
  }
  return FormatB(
    major: major,
    minor: buf[1],
    keyIndex: buf.buffer.asByteData().getUint16(2),
    identity: Uint8List.fromList(buf.sublist(4, 20)),
    flags: buf[20],
  );
}

/// Empreinte de l'identité : seule forme que le serveur conserve (`media.token_hash`).
Uint8List tokenHash(List<int> identity) {
  requireLength(identity, identityLength, 'BAD_IDENTITY', 'identité');
  return SHA256Digest().process(Uint8List.fromList(identity));
}
