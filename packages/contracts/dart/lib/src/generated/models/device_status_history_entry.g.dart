// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_status_history_entry.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceStatusHistoryEntry _$DeviceStatusHistoryEntryFromJson(
  Map<String, dynamic> json,
) => DeviceStatusHistoryEntry(
  fromStatus: $enumDecodeNullable(
    _$DeviceStatusHistoryEntryFromStatusEnumMap,
    json['from_status'],
  ),
  toStatus: $enumDecode(_$DeviceStatusEnumMap, json['to_status']),
  reason: json['reason'] as String?,
  actorId: json['actor_id'] as String?,
  at: DateTime.parse(json['at'] as String),
);

Map<String, dynamic> _$DeviceStatusHistoryEntryToJson(
  DeviceStatusHistoryEntry instance,
) => <String, dynamic>{
  'from_status': instance.fromStatus,
  'to_status': instance.toStatus,
  'reason': instance.reason,
  'actor_id': instance.actorId,
  'at': instance.at.toIso8601String(),
};

const _$DeviceStatusHistoryEntryFromStatusEnumMap = {
  DeviceStatusHistoryEntryFromStatus.active: 'ACTIVE',
  DeviceStatusHistoryEntryFromStatus.suspended: 'SUSPENDED',
  DeviceStatusHistoryEntryFromStatus.revoked: 'REVOKED',
  DeviceStatusHistoryEntryFromStatus.valueNull: null,
};

const _$DeviceStatusEnumMap = {
  DeviceStatus.active: 'ACTIVE',
  DeviceStatus.suspended: 'SUSPENDED',
  DeviceStatus.revoked: 'REVOKED',
};
