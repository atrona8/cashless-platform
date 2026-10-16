// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'encrypted_blob.g.dart';

@JsonSerializable()
class EncryptedBlob {
  const EncryptedBlob({
    required this.nonce,
    required this.ciphertext,
    required this.tag,
    this.alg,
    this.epk,
  });

  factory EncryptedBlob.fromJson(Map<String, Object?> json) =>
      _$EncryptedBlobFromJson(json);

  final String? alg;

  /// Clé publique éphémère ECDH (point non compressé, base64url).
  final String? epk;
  final String nonce;
  final String ciphertext;
  final String tag;

  Map<String, Object?> toJson() => _$EncryptedBlobToJson(this);
}
