// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Catalog _$CatalogFromJson(Map<String, dynamic> json) => Catalog(
  version: (json['version'] as num?)?.toInt(),
  items: (json['items'] as List<dynamic>?)
      ?.map((e) => CatalogItem.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$CatalogToJson(Catalog instance) => <String, dynamic>{
  'version': instance.version,
  'items': instance.items,
};
