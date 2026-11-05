// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_policy_level_view.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflinePolicyLevelView _$OfflinePolicyLevelViewFromJson(
  Map<String, dynamic> json,
) => OfflinePolicyLevelView(
  level: $enumDecode(_$OfflinePolicyLevelViewLevelEnumMap, json['level']),
  scopeId: json['scope_id'] as String,
  policy: OfflinePolicyLevel.fromJson(json['policy'] as Map<String, dynamic>),
  version: (json['version'] as num).toInt(),
  updatedAt: json['updated_at'] == null
      ? null
      : DateTime.parse(json['updated_at'] as String),
  updatedBy: json['updated_by'] as String?,
  effective: json['effective'] == null
      ? null
      : OfflinePolicy.fromJson(json['effective'] as Map<String, dynamic>),
  risk: json['risk'] == null
      ? null
      : OfflineRisk.fromJson(json['risk'] as Map<String, dynamic>),
);

Map<String, dynamic> _$OfflinePolicyLevelViewToJson(
  OfflinePolicyLevelView instance,
) => <String, dynamic>{
  'level': instance.level,
  'scope_id': instance.scopeId,
  'policy': instance.policy,
  'version': instance.version,
  'updated_at': instance.updatedAt?.toIso8601String(),
  'updated_by': instance.updatedBy,
  'effective': instance.effective,
  'risk': instance.risk,
};

const _$OfflinePolicyLevelViewLevelEnumMap = {
  OfflinePolicyLevelViewLevel.operatorCeiling: 'OPERATOR_CEILING',
  OfflinePolicyLevelViewLevel.organizer: 'ORGANIZER',
  OfflinePolicyLevelViewLevel.event: 'EVENT',
  OfflinePolicyLevelViewLevel.device: 'DEVICE',
};
