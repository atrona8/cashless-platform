// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_catalog.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeCatalog _$EdgeCatalogFromJson(Map<String, dynamic> json) => EdgeCatalog(
  posId: json['pos_id'] as String,
  version: (json['version'] as num).toInt(),
  items: (json['items'] as List<dynamic>)
      .map((e) => Items.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$EdgeCatalogToJson(EdgeCatalog instance) =>
    <String, dynamic>{
      'pos_id': instance.posId,
      'version': instance.version,
      'items': instance.items,
    };
