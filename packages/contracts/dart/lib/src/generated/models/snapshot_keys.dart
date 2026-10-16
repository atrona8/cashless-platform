// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'algorithm.dart';
import 'timestamp.dart';

part 'snapshot_keys.g.dart';

@JsonSerializable()
class SnapshotKeys {
  const SnapshotKeys({
    required this.keyId,
    required this.algorithm,
    required this.publicKey,
    this.notAfter,
  });

  factory SnapshotKeys.fromJson(Map<String, Object?> json) =>
      _$SnapshotKeysFromJson(json);

  @JsonKey(name: 'key_id')
  final String keyId;

  /// `ECDSA_P256_SHA256` par défaut ; Ed25519 si le KMS le permet (POINTS_OUVERTS OP-N13).
  final Algorithm algorithm;
  @JsonKey(name: 'public_key')
  final String publicKey;
  @JsonKey(name: 'not_after')
  final Timestamp? notAfter;

  Map<String, Object?> toJson() => _$SnapshotKeysToJson(this);
}
