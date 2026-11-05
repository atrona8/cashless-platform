// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_batch_header.dart';
import 'offline_operation.dart';

part 'offline_batch.g.dart';

@JsonSerializable()
class OfflineBatch {
  const OfflineBatch({
    required this.header,
    required this.operations,
    required this.signature,
  });

  factory OfflineBatch.fromJson(Map<String, Object?> json) =>
      _$OfflineBatchFromJson(json);

  final OfflineBatchHeader header;
  final List<OfflineOperation> operations;

  /// Signature ECDSA P-256 / SHA-256 (clé Keystore) de `JCS(header)`, **DER**, base64 standard.
  final String signature;

  Map<String, Object?> toJson() => _$OfflineBatchToJson(this);
}
