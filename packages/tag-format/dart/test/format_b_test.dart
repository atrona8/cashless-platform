// Format B 1.0 et CRC : vecteurs du kit (vecteurs_test_bracelet.py, SPECIFICATION §7.2) et refus.
import 'dart:convert';

import 'package:cashless_tag_format/cashless_tag_format.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  final v = vectors['format_b'] as Map<String, dynamic>;
  final refusals =
      (vectors['refusals'] as Map<String, dynamic>)['format_b']
          as List<dynamic>;

  test('CRC-32/ISO-HDLC : valeur de contrôle', () {
    final check = vectors['crc_check'] as Map<String, dynamic>;
    expect(
      toHex(crc32IsoHdlc(ascii.encode(check['input_ascii'] as String))),
      check['crc'],
    );
  });

  test('encode le vecteur du kit à l’octet près', () {
    final bytes = encodeFormatB(
      keyIndex: v['key_index'] as int,
      identity: hex(v['identity'] as String),
    );
    expect(toHex(bytes), v['bytes']);
    expect(toHex(bytes.sublist(24)), v['crc']);
  });

  test('décode le vecteur du kit', () {
    final decoded = decodeFormatB(hex(v['bytes'] as String));
    expect(
      [decoded.major, decoded.minor, decoded.keyIndex, decoded.flags],
      [v['major'], v['minor'], v['key_index'], v['flags']],
    );
    expect(toHex(decoded.identity), v['identity']);
  });

  for (final refusal in refusals.cast<Map<String, dynamic>>()) {
    test('refuse : ${refusal['name']}', () {
      expect(
        codeOf(() => decodeFormatB(hex(refusal['bytes'] as String))),
        refusal['code'],
      );
    });
  }

  test('accepte un mineur plus récent et des octets réservés non nuls', () {
    final bytes = hex(v['bytes'] as String);
    bytes[1] = 7;
    bytes[22] = 0xaa;
    bytes.setRange(24, 28, crc32IsoHdlc(bytes.sublist(0, 24)));
    final decoded = decodeFormatB(bytes);
    expect(
      [decoded.major, decoded.minor, decoded.keyIndex],
      [1, 7, v['key_index']],
    );
  });

  test('refuse un index de clé ou une identité hors bornes', () {
    final identity = hex(v['identity'] as String);
    expect(
      codeOf(() => encodeFormatB(keyIndex: 65536, identity: identity)),
      'BAD_KEY_INDEX',
    );
    expect(
      codeOf(() => encodeFormatB(keyIndex: -1, identity: identity)),
      'BAD_KEY_INDEX',
    );
    expect(
      codeOf(() => encodeFormatB(keyIndex: 1, identity: List.filled(15, 0))),
      'BAD_IDENTITY',
    );
    expect(codeOf(() => tokenHash(List.filled(17, 0))), 'BAD_IDENTITY');
  });

  test('aller-retour sur les bornes de l’index', () {
    for (final keyIndex in [0, 1, 255, 256, 65535]) {
      expect(
        decodeFormatB(
          encodeFormatB(
            keyIndex: keyIndex,
            identity: hex(v['identity'] as String),
          ),
        ).keyIndex,
        keyIndex,
      );
    }
  });
}
