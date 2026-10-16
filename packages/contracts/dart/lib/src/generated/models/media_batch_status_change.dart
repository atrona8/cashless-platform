// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_batch_status_change_status.dart';

part 'media_batch_status_change.g.dart';

@JsonSerializable()
class MediaBatchStatusChange {
  const MediaBatchStatusChange({required this.status, this.reason});

  factory MediaBatchStatusChange.fromJson(Map<String, Object?> json) =>
      _$MediaBatchStatusChangeFromJson(json);

  final MediaBatchStatusChangeStatus status;

  /// Obligatoire pour `SUSPENDED`.
  final String? reason;

  Map<String, Object?> toJson() => _$MediaBatchStatusChangeToJson(this);
}
