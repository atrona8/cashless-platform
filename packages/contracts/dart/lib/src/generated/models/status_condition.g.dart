// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'status_condition.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatusCondition _$StatusConditionFromJson(Map<String, dynamic> json) =>
    StatusCondition(
      code: json['code'] as String,
      met: json['met'] as bool?,
      detail: json['detail'] as String,
      source: $enumDecode(_$StatusConditionSourceEnumMap, json['source']),
      ownerMission: json['owner_mission'] as String?,
    );

Map<String, dynamic> _$StatusConditionToJson(StatusCondition instance) =>
    <String, dynamic>{
      'code': instance.code,
      'met': instance.met,
      'detail': instance.detail,
      'source': instance.source,
      'owner_mission': instance.ownerMission,
    };

const _$StatusConditionSourceEnumMap = {
  StatusConditionSource.database: 'DATABASE',
  StatusConditionSource.configuration: 'CONFIGURATION',
  StatusConditionSource.valueExternal: 'EXTERNAL',
};
