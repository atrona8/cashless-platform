// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_batch_header.dart';

part 'device_batches.g.dart';

@JsonSerializable()
class DeviceBatches {
  const DeviceBatches({required this.header, required this.signature});

  factory DeviceBatches.fromJson(Map<String, Object?> json) =>
      _$DeviceBatchesFromJson(json);

  final OfflineBatchHeader header;

  /// Signature d'origine du terminal (ECDSA P-256) sur JCS(header), relayée telle quelle.
  final String signature;

  Map<String, Object?> toJson() => _$DeviceBatchesToJson(this);
}
