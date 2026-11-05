// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'wrapped_key.g.dart';

/// Clé de contenu AES-256 (propre au snapshot) scellée pour la clé d'accord ECDH P-256 du terminal par la.
/// construction `sealForRecipient` de `@cashless/tag-format` (ECDH-ES P-256, HKDF-SHA256, AES-256-GCM ; plus.
/// de key wrap AES). AAD = `CASHLESS/SNAPKEY/v1 ‖ ledger_id ‖ version ‖ device_id`. Elle déchiffre les.
/// `pwd_pack_enc` des entrées.
///
@JsonSerializable()
class WrappedKey {
  const WrappedKey({
    required this.alg,
    required this.epk,
    required this.iv,
    required this.wrappedKey,
  });

  factory WrappedKey.fromJson(Map<String, Object?> json) =>
      _$WrappedKeyFromJson(json);

  final String alg;

  /// Clé publique éphémère (point non compressé, base64url).
  final String epk;

  /// Nonce AES-GCM de 12 octets (base64 standard).
  final String iv;

  /// Clé de contenu chiffrée suivie du tag AES-GCM (base64 standard).
  @JsonKey(name: 'wrapped_key')
  final String wrappedKey;

  Map<String, Object?> toJson() => _$WrappedKeyToJson(this);
}
