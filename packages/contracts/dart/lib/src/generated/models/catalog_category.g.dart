// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_category.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogCategory _$CatalogCategoryFromJson(Map<String, dynamic> json) =>
    CatalogCategory(
      categoryId: json['category_id'] as String,
      labelFr: json['label_fr'] as String,
      labelEn: json['label_en'] as String,
      position: (json['position'] as num).toInt(),
      active: json['active'] as bool,
    );

Map<String, dynamic> _$CatalogCategoryToJson(CatalogCategory instance) =>
    <String, dynamic>{
      'category_id': instance.categoryId,
      'label_fr': instance.labelFr,
      'label_en': instance.labelEn,
      'position': instance.position,
      'active': instance.active,
    };
