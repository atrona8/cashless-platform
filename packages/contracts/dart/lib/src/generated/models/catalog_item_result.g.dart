// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_item_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogItemResult _$CatalogItemResultFromJson(Map<String, dynamic> json) =>
    CatalogItemResult(
      item: CatalogItemAdmin.fromJson(json['item'] as Map<String, dynamic>),
      catalogVersion: (json['catalog_version'] as num).toInt(),
    );

Map<String, dynamic> _$CatalogItemResultToJson(CatalogItemResult instance) =>
    <String, dynamic>{
      'item': instance.item,
      'catalog_version': instance.catalogVersion,
    };
