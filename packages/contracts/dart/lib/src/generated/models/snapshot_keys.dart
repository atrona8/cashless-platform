// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'algorithm.dart';

part 'snapshot_keys.g.dart';

@JsonSerializable()
class SnapshotKeys {
  const SnapshotKeys({
    required this.keyId,
    required this.algorithm,
    required this.publicKey,
    required this.notAfter,
  });

  factory SnapshotKeys.fromJson(Map<String, Object?> json) =>
      _$SnapshotKeysFromJson(json);

  @JsonKey(name: 'key_id')
  final String keyId;

  /// `ECDSA_P256_SHA256` seulement.
  final Algorithm algorithm;

  /// Clé publique, SPKI DER en base64 standard.
  @JsonKey(name: 'public_key')
  final String publicKey;

  /// Fin de validité de la clé ; `null` pour une clé `ACTIVE` (aucune date de fin).
  @JsonKey(name: 'not_after')
  final DateTime? notAfter;

  Map<String, Object?> toJson() => _$SnapshotKeysToJson(this);
}
