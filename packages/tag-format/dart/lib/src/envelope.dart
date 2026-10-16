// Stockage chiffré de PWD‖PACK (SPECIFICATION §7.4) : AES-256-GCM sous la clé de données.
// Valeur stockée : nonce (12) ‖ chiffré (6) ‖ étiquette (16) = 34 octets. L'AAD lie le secret à CE bracelet.
import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/api.dart';
import 'package:pointycastle/block/aes.dart';
import 'package:pointycastle/block/modes/gcm.dart';

import 'errors.dart';
import 'format_b.dart';
import 'kdf.dart';

const int dekLength = 32;
const int nonceLength = 12;
const int tagLength = 16;
const int pwdPackEncLength = nonceLength + pwdPackLength + tagLength;

final List<int> _aadPrefix = ascii.encode('CASHLESS/PWDPACK/v1');

Uint8List pwdPackAad({
  required String mediaId,
  required String operatorId,
  required int keyIndex,
  required List<int> uid,
}) {
  assertKeyIndex(keyIndex);
  assertUid(uid);
  final out = BytesBuilder()
    ..add(_aadPrefix)
    ..add(uuidToBytes(mediaId))
    ..add(uuidToBytes(operatorId))
    ..add([keyIndex >> 8, keyIndex & 0xFF])
    ..add(uid);
  return out.toBytes();
}

GCMBlockCipher _gcm(
  bool encrypt,
  List<int> dek,
  List<int> nonce,
  List<int> aad,
) {
  return GCMBlockCipher(AESEngine())..init(
    encrypt,
    AEADParameters(
      KeyParameter(Uint8List.fromList(dek)),
      tagLength * 8,
      Uint8List.fromList(nonce),
      Uint8List.fromList(aad),
    ),
  );
}

/// Le nonce est fourni par l'appelant (12 octets aléatoires en production) : la bibliothèque ne tire aucun aléa ici.
Uint8List sealPwdPack({
  required List<int> dek,
  required List<int> nonce,
  required List<int> pwdPack,
  required List<int> aad,
}) {
  requireLength(dek, dekLength, 'BAD_KEY', 'clé de données');
  requireLength(nonce, nonceLength, 'BAD_LENGTH', 'nonce');
  requireLength(pwdPack, pwdPackLength, 'BAD_LENGTH', 'PWD‖PACK');
  final sealed = _gcm(
    true,
    dek,
    nonce,
    aad,
  ).process(Uint8List.fromList(pwdPack)); // chiffré ‖ étiquette
  return Uint8List.fromList([...nonce, ...sealed]);
}

Uint8List openPwdPack({
  required List<int> dek,
  required List<int> blob,
  required List<int> aad,
}) {
  requireLength(dek, dekLength, 'BAD_KEY', 'clé de données');
  requireLength(blob, pwdPackEncLength, 'BAD_LENGTH', 'pwd_pack_enc');
  try {
    return _gcm(
      false,
      dek,
      blob.sublist(0, nonceLength),
      aad,
    ).process(Uint8List.fromList(blob.sublist(nonceLength)));
  } on InvalidCipherTextException {
    throw TagFormatException(
      'AUTH_FAILED',
      'déchiffrement refusé : clé, chiffré ou AAD incorrect',
    );
  }
}
