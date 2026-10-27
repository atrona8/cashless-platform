// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_category_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogCategoryResult _$CatalogCategoryResultFromJson(
  Map<String, dynamic> json,
) => CatalogCategoryResult(
  category: CatalogCategory.fromJson(json['category'] as Map<String, dynamic>),
  catalogVersion: (json['catalog_version'] as num).toInt(),
);

Map<String, dynamic> _$CatalogCategoryResultToJson(
  CatalogCategoryResult instance,
) => <String, dynamic>{
  'category': instance.category,
  'catalog_version': instance.catalogVersion,
};
