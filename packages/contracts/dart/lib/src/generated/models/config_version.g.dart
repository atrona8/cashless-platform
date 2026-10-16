// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'config_version.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ConfigVersion _$ConfigVersionFromJson(Map<String, dynamic> json) =>
    ConfigVersion(
      configVersionId: json['config_version_id'] as String,
      operatorId: json['operator_id'] as String?,
      scopeType: $enumDecode(_$ConfigLevelEnumMap, json['scope_type']),
      scopeId: json['scope_id'] as String,
      version: (json['version'] as num).toInt(),
      validFrom: DateTime.parse(json['valid_from'] as String),
      settings: json['settings'],
    );

Map<String, dynamic> _$ConfigVersionToJson(ConfigVersion instance) =>
    <String, dynamic>{
      'config_version_id': instance.configVersionId,
      'operator_id': instance.operatorId,
      'scope_type': instance.scopeType,
      'scope_id': instance.scopeId,
      'version': instance.version,
      'valid_from': instance.validFrom.toIso8601String(),
      'settings': instance.settings,
    };

const _$ConfigLevelEnumMap = {
  ConfigLevel.platform: 'PLATFORM',
  ConfigLevel.valueOperator: 'OPERATOR',
  ConfigLevel.organizer: 'ORGANIZER',
  ConfigLevel.event: 'EVENT',
  ConfigLevel.participation: 'PARTICIPATION',
};
