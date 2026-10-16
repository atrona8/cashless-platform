// Preuve croisée (SC-001) : les 1 000 entrées de `../vectors/cross-impl.json`, écrites par la suite TypeScript,
// doivent donner ici exactement les mêmes octets.
import 'dart:convert';
import 'dart:io';

import 'package:cashless_tag_format/cashless_tag_format.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  final file =
      jsonDecode(File('../vectors/cross-impl.json').readAsStringSync())
          as Map<String, dynamic>;
  final entries = (file['entries'] as List<dynamic>)
      .cast<Map<String, dynamic>>();

  test(
    '${entries.length} entrées : octets identiques à l’implémentation TypeScript',
    () {
      expect(entries.length, file['count']);
      expect(entries.length, greaterThanOrEqualTo(1000));
      for (final entry in entries) {
        final out = entry['out'] as Map<String, dynamic>;
        final keyIndex = entry['key_index'] as int;
        final identity = hex(entry['identity'] as String);
        final operatorId = entry['operator_id'] as String;
        final mediaId = entry['media_id'] as String;
        final uid = hex(entry['uid'] as String);
        final aad = pwdPackAad(
          mediaId: mediaId,
          operatorId: operatorId,
          keyIndex: keyIndex,
          uid: uid,
        );
        final code = generateClaimCode(hex(entry['claim_bytes'] as String));
        final sealed = sealPwdPack(
          dek: hex(entry['dek'] as String),
          nonce: hex(entry['nonce'] as String),
          pwdPack: hex(entry['pwd_pack'] as String),
          aad: aad,
        );

        expect(
          toHex(encodeFormatB(keyIndex: keyIndex, identity: identity)),
          out['format_b'],
        );
        expect(toHex(tokenHash(identity)), out['token_hash']);
        expect(
          toHex(
            derivationMessage(
              operatorId: operatorId,
              keyIndex: keyIndex,
              uid: uid,
            ),
          ),
          out['derivation_message'],
        );
        expect(toHex(aad), out['aad']);
        expect(toHex(sealed), out['pwd_pack_enc']);
        expect(code, out['claim_code']);
        expect(formatClaimCode(code), out['claim_code_formatted']);
        // Et l'inverse : ce que TypeScript a scellé se rouvre ici.
        expect(
          toHex(
            openPwdPack(
              dek: hex(entry['dek'] as String),
              blob: hex(out['pwd_pack_enc'] as String),
              aad: aad,
            ),
          ),
          entry['pwd_pack'],
        );
        expect(
          decodeFormatB(hex(out['format_b'] as String)).keyIndex,
          keyIndex,
        );
      }
    },
  );
}
