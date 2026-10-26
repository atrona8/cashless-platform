// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_item_update.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogItemUpdate _$CatalogItemUpdateFromJson(Map<String, dynamic> json) =>
    CatalogItemUpdate(
      categoryId: json['category_id'] as String?,
      labelFr: json['label_fr'] as String?,
      labelEn: json['label_en'] as String?,
      unitPrice: (json['unit_price'] as num?)?.toInt(),
      vatRateBps: (json['vat_rate_bps'] as num?)?.toInt(),
      active: json['active'] as bool?,
    );

Map<String, dynamic> _$CatalogItemUpdateToJson(CatalogItemUpdate instance) =>
    <String, dynamic>{
      'category_id': instance.categoryId,
      'label_fr': instance.labelFr,
      'label_en': instance.labelEn,
      'unit_price': instance.unitPrice,
      'vat_rate_bps': instance.vatRateBps,
      'active': instance.active,
    };
