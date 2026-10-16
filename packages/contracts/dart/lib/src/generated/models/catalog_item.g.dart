// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_item.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogItem _$CatalogItemFromJson(Map<String, dynamic> json) => CatalogItem(
  productId: json['product_id'] as String,
  name: json['name'] as String,
  unitPrice: (json['unit_price'] as num).toInt(),
  category: json['category'] as String?,
  vatRateBps: (json['vat_rate_bps'] as num?)?.toInt(),
);

Map<String, dynamic> _$CatalogItemToJson(CatalogItem instance) =>
    <String, dynamic>{
      'product_id': instance.productId,
      'name': instance.name,
      'unit_price': instance.unitPrice,
      'category': instance.category,
      'vat_rate_bps': instance.vatRateBps,
    };
