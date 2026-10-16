// Dérivation SP 800-108 et stockage chiffré de PWD‖PACK : vecteurs du kit (SPECIFICATION §7.3, §7.4) et refus.
import 'package:cashless_tag_format/cashless_tag_format.dart';
import 'package:pointycastle/api.dart';
import 'package:pointycastle/digests/sha256.dart';
import 'package:pointycastle/macs/hmac.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  final k = vectors['kdf'] as Map<String, dynamic>;
  final e = vectors['envelope'] as Map<String, dynamic>;
  final refusals =
      (vectors['refusals'] as Map<String, dynamic>)['envelope']
          as List<dynamic>;
  final operatorId = k['operator_id'] as String;
  final keyIndex = k['key_index'] as int;
  final uid = hex(k['uid'] as String);
  final mediaId = e['media_id'] as String;
  final dek = hex(e['dek'] as String);
  aad() => pwdPackAad(
    mediaId: mediaId,
    operatorId: operatorId,
    keyIndex: keyIndex,
    uid: uid,
  );

  test('construit le message de GenerateMac du kit', () {
    expect(
      toHex(
        derivationMessage(operatorId: operatorId, keyIndex: keyIndex, uid: uid),
      ),
      k['message'],
    );
  });

  test('un HMAC-SHA256 sous la clé de test donne PWD et PACK du kit', () {
    final hmac = HMac(SHA256Digest(), 64)
      ..init(KeyParameter(hex(k['test_key'] as String)));
    final split = splitPwdPack(hmac.process(hex(k['message'] as String)));
    expect(
      [toHex(split.pwdPack), toHex(split.pwd), toHex(split.pack)],
      [k['okm'], k['pwd'], k['pack']],
    );
  });

  test('refuse un UID, un index ou un prestataire mal formés', () {
    expect(
      codeOf(
        () => derivationMessage(
          operatorId: operatorId,
          keyIndex: 1,
          uid: List.filled(6, 0),
        ),
      ),
      'BAD_UID',
    );
    expect(
      codeOf(
        () => derivationMessage(
          operatorId: operatorId,
          keyIndex: 70000,
          uid: uid,
        ),
      ),
      'BAD_KEY_INDEX',
    );
    expect(
      codeOf(
        () =>
            derivationMessage(operatorId: 'pas-un-uuid', keyIndex: 1, uid: uid),
      ),
      'BAD_UUID',
    );
    expect(codeOf(() => splitPwdPack(List.filled(5, 0))), 'BAD_LENGTH');
  });

  test('construit l’AAD du kit', () {
    expect(toHex(aad()), e['aad']);
  });

  test('scelle les 34 octets du kit et les rouvre', () {
    final blob = sealPwdPack(
      dek: dek,
      nonce: hex(e['nonce'] as String),
      pwdPack: hex(e['plaintext'] as String),
      aad: aad(),
    );
    expect(toHex(blob), e['pwd_pack_enc']);
    expect(
      toHex(openPwdPack(dek: dek, blob: blob, aad: aad())),
      e['plaintext'],
    );
  });

  for (final refusal in refusals.cast<Map<String, dynamic>>()) {
    test('refuse : ${refusal['name']}', () {
      expect(
        codeOf(
          () => openPwdPack(
            dek: dek,
            blob: hex(refusal['blob'] as String),
            aad: hex(refusal['aad'] as String),
          ),
        ),
        refusal['code'],
      );
    });
  }

  test(
    'un autre bracelet, prestataire, index ou UID fait échouer l’ouverture',
    () {
      final blob = hex(e['pwd_pack_enc'] as String);
      final others = [
        pwdPackAad(
          mediaId: '40000000-0000-0000-0000-000000000002',
          operatorId: operatorId,
          keyIndex: keyIndex,
          uid: uid,
        ),
        pwdPackAad(
          mediaId: mediaId,
          operatorId: '00000000-0000-0000-0000-000000000003',
          keyIndex: keyIndex,
          uid: uid,
        ),
        pwdPackAad(
          mediaId: mediaId,
          operatorId: operatorId,
          keyIndex: 2,
          uid: uid,
        ),
        pwdPackAad(
          mediaId: mediaId,
          operatorId: operatorId,
          keyIndex: keyIndex,
          uid: hex('04a1b2c3d4e5f7'),
        ),
      ];
      for (final other in others) {
        expect(
          codeOf(() => openPwdPack(dek: dek, blob: blob, aad: other)),
          'AUTH_FAILED',
        );
      }
      expect(
        codeOf(
          () => openPwdPack(dek: List.filled(32, 9), blob: blob, aad: aad()),
        ),
        'AUTH_FAILED',
      );
    },
  );

  test('refuse une clé, un nonce ou un clair de mauvaise longueur', () {
    final nonce = hex(e['nonce'] as String);
    final plain = hex(e['plaintext'] as String);
    expect(
      codeOf(
        () => sealPwdPack(
          dek: List.filled(16, 0),
          nonce: nonce,
          pwdPack: plain,
          aad: aad(),
        ),
      ),
      'BAD_KEY',
    );
    expect(
      codeOf(
        () => sealPwdPack(
          dek: dek,
          nonce: List.filled(11, 0),
          pwdPack: plain,
          aad: aad(),
        ),
      ),
      'BAD_LENGTH',
    );
    expect(
      codeOf(
        () => sealPwdPack(
          dek: dek,
          nonce: nonce,
          pwdPack: List.filled(5, 0),
          aad: aad(),
        ),
      ),
      'BAD_LENGTH',
    );
  });
}
