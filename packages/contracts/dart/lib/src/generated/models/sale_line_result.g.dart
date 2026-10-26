// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_line_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaleLineResult _$SaleLineResultFromJson(Map<String, dynamic> json) =>
    SaleLineResult(
      productId: json['product_id'] as String,
      label: json['label'] as String,
      quantity: (json['quantity'] as num).toInt(),
      unitPrice: (json['unit_price'] as num).toInt(),
      vatRateBps: (json['vat_rate_bps'] as num).toInt(),
      lineTotal: (json['line_total'] as num).toInt(),
      catalogVersion: (json['catalog_version'] as num).toInt(),
    );

Map<String, dynamic> _$SaleLineResultToJson(SaleLineResult instance) =>
    <String, dynamic>{
      'product_id': instance.productId,
      'label': instance.label,
      'quantity': instance.quantity,
      'unit_price': instance.unitPrice,
      'vat_rate_bps': instance.vatRateBps,
      'line_total': instance.lineTotal,
      'catalog_version': instance.catalogVersion,
    };
