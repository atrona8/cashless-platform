import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cashless_tag_format/cashless_tag_format.dart';

/// Vecteurs du paquet parent, produits par le script du kit (`../vectors/vectors.json`).
final Map<String, dynamic> vectors =
    jsonDecode(File('../vectors/vectors.json').readAsStringSync())
        as Map<String, dynamic>;

Uint8List hex(String value) {
  final out = Uint8List(value.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(value.substring(2 * i, 2 * i + 2), radix: 16);
  }
  return out;
}

String toHex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

String? codeOf(void Function() fn) {
  try {
    fn();
  } on TagFormatException catch (error) {
    return error.code;
  }
  return null;
}
