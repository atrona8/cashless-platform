// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'heartbeat_request.g.dart';

@JsonSerializable()
class HeartbeatRequest {
  const HeartbeatRequest({
    required this.deviceTime,
    required this.lastLocalSeq,
    required this.pendingOperations,
    this.snapshotVersion,
    this.pendingExposure,
    this.batteryPercent,
    this.appVersion,
  });

  factory HeartbeatRequest.fromJson(Map<String, Object?> json) =>
      _$HeartbeatRequestFromJson(json);

  @JsonKey(name: 'device_time')
  final Timestamp deviceTime;
  @JsonKey(name: 'snapshot_version')
  final int? snapshotVersion;
  @JsonKey(name: 'last_local_seq')
  final int lastLocalSeq;
  @JsonKey(name: 'pending_operations')
  final int pendingOperations;

  /// Somme des débits hors ligne non acquittés.
  @JsonKey(name: 'pending_exposure')
  final int? pendingExposure;
  @JsonKey(name: 'battery_percent')
  final int? batteryPercent;
  @JsonKey(name: 'app_version')
  final String? appVersion;

  Map<String, Object?> toJson() => _$HeartbeatRequestToJson(this);
}
