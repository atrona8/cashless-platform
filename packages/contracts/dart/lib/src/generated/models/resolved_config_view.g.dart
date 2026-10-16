// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'resolved_config_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ResolvedConfigView _$ResolvedConfigViewFromJson(Map<String, dynamic> json) =>
    ResolvedConfigView(
      value: json['value'],
      level: $enumDecodeNullable(_$ConfigLevelEnumMap, json['level']),
      version: (json['version'] as num?)?.toInt(),
      configVersionId: json['config_version_id'] as String?,
      provisional: json['provisional'] as bool,
    );

Map<String, dynamic> _$ResolvedConfigViewToJson(ResolvedConfigView instance) =>
    <String, dynamic>{
      'value': instance.value,
      'level': instance.level,
      'version': instance.version,
      'config_version_id': instance.configVersionId,
      'provisional': instance.provisional,
    };

const _$ConfigLevelEnumMap = {
  ConfigLevel.platform: 'PLATFORM',
  ConfigLevel.valueOperator: 'OPERATOR',
  ConfigLevel.organizer: 'ORGANIZER',
  ConfigLevel.event: 'EVENT',
  ConfigLevel.participation: 'PARTICIPATION',
};
