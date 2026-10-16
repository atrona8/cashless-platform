// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data_key_versions.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DataKeyVersions _$DataKeyVersionsFromJson(Map<String, dynamic> json) =>
    DataKeyVersions(
      version: (json['version'] as num).toInt(),
      status: $enumDecode(_$TagKeyStatusEnumMap, json['status']),
      createdAt: DateTime.parse(json['created_at'] as String),
    );

Map<String, dynamic> _$DataKeyVersionsToJson(DataKeyVersions instance) =>
    <String, dynamic>{
      'version': instance.version,
      'status': instance.status,
      'created_at': instance.createdAt.toIso8601String(),
    };

const _$TagKeyStatusEnumMap = {
  TagKeyStatus.active: 'ACTIVE',
  TagKeyStatus.decryptOnly: 'DECRYPT_ONLY',
  TagKeyStatus.retired: 'RETIRED',
};
