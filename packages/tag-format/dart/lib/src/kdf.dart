// Dérivation du mot de passe d'un bracelet (SPECIFICATION §7.3) : KDF NIST SP 800-108 en mode compteur, PRF
// HMAC-SHA256, un seul bloc. Le message construit ici est passé tel quel à KMS GenerateMac.
import 'dart:convert';
import 'dart:typed_data';

import 'errors.dart';
import 'format_b.dart';

const int uidLength = 7;
const int pwdPackLength = 6;

final List<int> _label = ascii.encode('CASHLESS/UL-EV1/PWD/v1');
final RegExp _uuid = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

Uint8List uuidToBytes(String uuid) {
  if (!_uuid.hasMatch(uuid)) {
    throw TagFormatException('BAD_UUID', 'identifiant UUID attendu');
  }
  final hex = uuid.replaceAll('-', '');
  final out = Uint8List(16);
  for (var i = 0; i < 16; i++) {
    out[i] = int.parse(hex.substring(2 * i, 2 * i + 2), radix: 16);
  }
  return out;
}

void assertUid(List<int> uid) =>
    requireLength(uid, uidLength, 'BAD_UID', 'UID');

Uint8List derivationMessage({
  required String operatorId,
  required int keyIndex,
  required List<int> uid,
}) {
  assertKeyIndex(keyIndex);
  assertUid(uid);
  final out = BytesBuilder()
    ..add(const [0, 0, 0, 1]) // compteur
    ..add(_label)
    ..addByte(0)
    ..add(uuidToBytes(operatorId))
    ..add([keyIndex >> 8, keyIndex & 0xFF])
    ..add(uid)
    ..add(const [0, 0, 0, 0x30]); // 48 bits : PWD (4 octets) + PACK (2 octets)
  return out.toBytes();
}

class PwdPack {
  PwdPack(this.pwdPack);

  final Uint8List pwdPack;
  Uint8List get pwd => Uint8List.sublistView(pwdPack, 0, 4);
  Uint8List get pack => Uint8List.sublistView(pwdPack, 4, 6);
}

/// Sépare les 6 premiers octets du MAC : `PWD‖PACK`, `PWD` (4 octets) et `PACK` (2 octets).
PwdPack splitPwdPack(List<int> mac) {
  if (mac.length < pwdPackLength) {
    throw TagFormatException('BAD_LENGTH', 'MAC trop court');
  }
  return PwdPack(Uint8List.fromList(mac.sublist(0, pwdPackLength)));
}
