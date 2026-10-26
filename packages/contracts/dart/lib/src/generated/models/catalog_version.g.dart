// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_version.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogVersion _$CatalogVersionFromJson(Map<String, dynamic> json) =>
    CatalogVersion(
      posId: json['pos_id'] as String,
      version: (json['version'] as num).toInt(),
      createdAt: DateTime.parse(json['created_at'] as String),
      items: (json['items'] as List<dynamic>)
          .map((e) => CatalogVersionItem.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$CatalogVersionToJson(CatalogVersion instance) =>
    <String, dynamic>{
      'pos_id': instance.posId,
      'version': instance.version,
      'created_at': instance.createdAt.toIso8601String(),
      'items': instance.items,
    };
