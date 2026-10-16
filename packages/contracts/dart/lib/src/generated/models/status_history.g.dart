// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'status_history.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatusHistory _$StatusHistoryFromJson(Map<String, dynamic> json) =>
    StatusHistory(
      toStatus: $enumDecode(_$MediaStatusEnumMap, json['to_status']),
      at: DateTime.parse(json['at'] as String),
      fromStatus: $enumDecodeNullable(
        _$MediaStatusEnumMap,
        json['from_status'],
      ),
      reason: json['reason'] as String?,
      actorId: json['actor_id'] as String?,
      approvedBy: json['approved_by'] as String?,
    );

Map<String, dynamic> _$StatusHistoryToJson(StatusHistory instance) =>
    <String, dynamic>{
      'from_status': instance.fromStatus,
      'to_status': instance.toStatus,
      'reason': instance.reason,
      'actor_id': instance.actorId,
      'approved_by': instance.approvedBy,
      'at': instance.at.toIso8601String(),
    };

const _$MediaStatusEnumMap = {
  MediaStatus.personalized: 'PERSONALIZED',
  MediaStatus.issued: 'ISSUED',
  MediaStatus.active: 'ACTIVE',
  MediaStatus.suspended: 'SUSPENDED',
  MediaStatus.replaced: 'REPLACED',
  MediaStatus.blacklisted: 'BLACKLISTED',
  MediaStatus.released: 'RELEASED',
  MediaStatus.retired: 'RETIRED',
  MediaStatus.destroyed: 'DESTROYED',
};
