// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_item_admin.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogItemAdmin _$CatalogItemAdminFromJson(Map<String, dynamic> json) =>
    CatalogItemAdmin(
      itemId: json['item_id'] as String,
      categoryId: json['category_id'] as String,
      labelFr: json['label_fr'] as String,
      labelEn: json['label_en'] as String,
      unitPrice: (json['unit_price'] as num).toInt(),
      vatRateBps: (json['vat_rate_bps'] as num).toInt(),
      active: json['active'] as bool,
    );

Map<String, dynamic> _$CatalogItemAdminToJson(CatalogItemAdmin instance) =>
    <String, dynamic>{
      'item_id': instance.itemId,
      'category_id': instance.categoryId,
      'label_fr': instance.labelFr,
      'label_en': instance.labelEn,
      'unit_price': instance.unitPrice,
      'vat_rate_bps': instance.vatRateBps,
      'active': instance.active,
    };
