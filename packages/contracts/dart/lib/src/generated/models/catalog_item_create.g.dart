// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_item_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogItemCreate _$CatalogItemCreateFromJson(Map<String, dynamic> json) =>
    CatalogItemCreate(
      labelFr: json['label_fr'] as String,
      labelEn: json['label_en'] as String,
      unitPrice: (json['unit_price'] as num).toInt(),
      vatRateBps: (json['vat_rate_bps'] as num).toInt(),
    );

Map<String, dynamic> _$CatalogItemCreateToJson(CatalogItemCreate instance) =>
    <String, dynamic>{
      'label_fr': instance.labelFr,
      'label_en': instance.labelEn,
      'unit_price': instance.unitPrice,
      'vat_rate_bps': instance.vatRateBps,
    };
