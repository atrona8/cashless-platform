// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'items.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Items _$ItemsFromJson(Map<String, dynamic> json) => Items(
  productId: json['product_id'] as String,
  nameFr: json['name_fr'] as String,
  nameEn: json['name_en'] as String,
  unitPrice: (json['unit_price'] as num).toInt(),
  vatRateBps: (json['vat_rate_bps'] as num).toInt(),
  categoryFr: json['category_fr'] as String?,
  categoryEn: json['category_en'] as String?,
);

Map<String, dynamic> _$ItemsToJson(Items instance) => <String, dynamic>{
  'product_id': instance.productId,
  'name_fr': instance.nameFr,
  'name_en': instance.nameEn,
  'category_fr': instance.categoryFr,
  'category_en': instance.categoryEn,
  'unit_price': instance.unitPrice,
  'vat_rate_bps': instance.vatRateBps,
};
