// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'account_mapping_version.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AccountMappingVersion _$AccountMappingVersionFromJson(
  Map<String, dynamic> json,
) => AccountMappingVersion(
  entityPartyId: json['entity_party_id'] as String,
  validFrom: DateTime.parse(json['valid_from'] as String),
  mappings: (json['mappings'] as List<dynamic>)
      .map((e) => AccountMapping.fromJson(e as Map<String, dynamic>))
      .toList(),
  version: (json['version'] as num?)?.toInt(),
  createdBy: json['created_by'] as String?,
);

Map<String, dynamic> _$AccountMappingVersionToJson(
  AccountMappingVersion instance,
) => <String, dynamic>{
  'entity_party_id': instance.entityPartyId,
  'version': instance.version,
  'valid_from': instance.validFrom.toIso8601String(),
  'created_by': instance.createdBy,
  'mappings': instance.mappings,
};
