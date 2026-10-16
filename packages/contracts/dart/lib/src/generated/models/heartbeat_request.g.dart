// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'heartbeat_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

HeartbeatRequest _$HeartbeatRequestFromJson(Map<String, dynamic> json) =>
    HeartbeatRequest(
      deviceTime: DateTime.parse(json['device_time'] as String),
      lastLocalSeq: (json['last_local_seq'] as num).toInt(),
      pendingOperations: (json['pending_operations'] as num).toInt(),
      snapshotVersion: (json['snapshot_version'] as num?)?.toInt(),
      pendingExposure: (json['pending_exposure'] as num?)?.toInt(),
      batteryPercent: (json['battery_percent'] as num?)?.toInt(),
      appVersion: json['app_version'] as String?,
    );

Map<String, dynamic> _$HeartbeatRequestToJson(HeartbeatRequest instance) =>
    <String, dynamic>{
      'device_time': instance.deviceTime.toIso8601String(),
      'snapshot_version': instance.snapshotVersion,
      'last_local_seq': instance.lastLocalSeq,
      'pending_operations': instance.pendingOperations,
      'pending_exposure': instance.pendingExposure,
      'battery_percent': instance.batteryPercent,
      'app_version': instance.appVersion,
    };
