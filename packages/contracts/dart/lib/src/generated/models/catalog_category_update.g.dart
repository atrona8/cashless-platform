// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_category_update.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogCategoryUpdate _$CatalogCategoryUpdateFromJson(
  Map<String, dynamic> json,
) => CatalogCategoryUpdate(
  labelFr: json['label_fr'] as String?,
  labelEn: json['label_en'] as String?,
  position: (json['position'] as num?)?.toInt(),
  active: json['active'] as bool?,
);

Map<String, dynamic> _$CatalogCategoryUpdateToJson(
  CatalogCategoryUpdate instance,
) => <String, dynamic>{
  'label_fr': instance.labelFr,
  'label_en': instance.labelEn,
  'position': instance.position,
  'active': instance.active,
};
