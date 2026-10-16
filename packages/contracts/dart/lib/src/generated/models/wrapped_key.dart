// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'wrapped_key.g.dart';

/// Clé de contenu AES-256 (propre au snapshot) enveloppée pour la clé d'accord ECDH P-256 du terminal.
/// (ECDH-ES + HKDF-SHA256 + AES Key Wrap). Elle déchiffre les `pwd_pack_enc` des entrées.
///
@JsonSerializable()
class WrappedKey {
  const WrappedKey({
    required this.alg,
    required this.epk,
    required this.wrappedKey,
  });

  factory WrappedKey.fromJson(Map<String, Object?> json) =>
      _$WrappedKeyFromJson(json);

  final String alg;

  /// Clé publique éphémère (base64url).
  final String epk;
  @JsonKey(name: 'wrapped_key')
  final String wrappedKey;

  Map<String, Object?> toJson() => _$WrappedKeyToJson(this);
}
