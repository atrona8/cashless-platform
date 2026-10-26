// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_category_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogCategoryCreate _$CatalogCategoryCreateFromJson(
  Map<String, dynamic> json,
) => CatalogCategoryCreate(
  labelFr: json['label_fr'] as String,
  labelEn: json['label_en'] as String,
  position: (json['position'] as num?)?.toInt(),
);

Map<String, dynamic> _$CatalogCategoryCreateToJson(
  CatalogCategoryCreate instance,
) => <String, dynamic>{
  'label_fr': instance.labelFr,
  'label_en': instance.labelEn,
  'position': instance.position,
};
