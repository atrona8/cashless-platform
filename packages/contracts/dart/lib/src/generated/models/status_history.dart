// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_status.dart';
import 'timestamp.dart';

part 'status_history.g.dart';

@JsonSerializable()
class StatusHistory {
  const StatusHistory({
    required this.toStatus,
    required this.at,
    this.fromStatus,
    this.reason,
    this.actorId,
    this.approvedBy,
  });

  factory StatusHistory.fromJson(Map<String, Object?> json) =>
      _$StatusHistoryFromJson(json);

  @JsonKey(name: 'from_status')
  final MediaStatus? fromStatus;
  @JsonKey(name: 'to_status')
  final MediaStatus toStatus;
  final String? reason;
  @JsonKey(name: 'actor_id')
  final String? actorId;
  @JsonKey(name: 'approved_by')
  final String? approvedBy;
  final Timestamp at;

  Map<String, Object?> toJson() => _$StatusHistoryToJson(this);
}
