// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tag_key.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TagKey _$TagKeyFromJson(Map<String, dynamic> json) => TagKey(
  operatorId: json['operator_id'] as String,
  keyIndex: (json['key_index'] as num).toInt(),
  status: $enumDecode(_$TagKeyStatusEnumMap, json['status']),
  scope: $enumDecode(_$TagKeyScopeEnumMap, json['scope']),
  kmsKeyRefSuffix: json['kms_key_ref_suffix'] as String,
  createdAt: DateTime.parse(json['created_at'] as String),
  dedicatedEventId: json['dedicated_event_id'] as String?,
  kmsDisabledAt: json['kms_disabled_at'] == null
      ? null
      : DateTime.parse(json['kms_disabled_at'] as String),
);

Map<String, dynamic> _$TagKeyToJson(TagKey instance) => <String, dynamic>{
  'operator_id': instance.operatorId,
  'key_index': instance.keyIndex,
  'status': instance.status,
  'scope': instance.scope,
  'dedicated_event_id': instance.dedicatedEventId,
  'kms_key_ref_suffix': instance.kmsKeyRefSuffix,
  'kms_disabled_at': instance.kmsDisabledAt?.toIso8601String(),
  'created_at': instance.createdAt.toIso8601String(),
};

const _$TagKeyStatusEnumMap = {
  TagKeyStatus.active: 'ACTIVE',
  TagKeyStatus.decryptOnly: 'DECRYPT_ONLY',
  TagKeyStatus.retired: 'RETIRED',
};

const _$TagKeyScopeEnumMap = {
  TagKeyScope.shared: 'SHARED',
  TagKeyScope.dedicated: 'DEDICATED',
};
