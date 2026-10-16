// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'heartbeat_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

HeartbeatResponse _$HeartbeatResponseFromJson(Map<String, dynamic> json) =>
    HeartbeatResponse(
      serverTime: DateTime.parse(json['server_time'] as String),
      configEtag: json['config_etag'] as String,
      latestSnapshotVersion: (json['latest_snapshot_version'] as num?)?.toInt(),
      debitAuthority: DebitAuthority.fromJson(
        json['debit_authority'] as Map<String, dynamic>,
      ),
      syncRequested: json['sync_requested'] as bool,
    );

Map<String, dynamic> _$HeartbeatResponseToJson(HeartbeatResponse instance) =>
    <String, dynamic>{
      'server_time': instance.serverTime.toIso8601String(),
      'config_etag': instance.configEtag,
      'latest_snapshot_version': instance.latestSnapshotVersion,
      'debit_authority': instance.debitAuthority,
      'sync_requested': instance.syncRequested,
    };
