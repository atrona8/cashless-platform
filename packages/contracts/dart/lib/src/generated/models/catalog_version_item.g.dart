// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_version_item.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogVersionItem _$CatalogVersionItemFromJson(Map<String, dynamic> json) =>
    CatalogVersionItem(
      itemId: json['item_id'] as String,
      categoryId: json['category_id'] as String,
      labelFr: json['label_fr'] as String,
      labelEn: json['label_en'] as String,
      unitPrice: (json['unit_price'] as num).toInt(),
      vatRateBps: (json['vat_rate_bps'] as num).toInt(),
    );

Map<String, dynamic> _$CatalogVersionItemToJson(CatalogVersionItem instance) =>
    <String, dynamic>{
      'item_id': instance.itemId,
      'category_id': instance.categoryId,
      'label_fr': instance.labelFr,
      'label_en': instance.labelEn,
      'unit_price': instance.unitPrice,
      'vat_rate_bps': instance.vatRateBps,
    };
