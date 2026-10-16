// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_line.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaleLine _$SaleLineFromJson(Map<String, dynamic> json) => SaleLine(
  quantity: (json['quantity'] as num).toInt(),
  unitPrice: (json['unit_price'] as num).toInt(),
  productId: json['product_id'] as String?,
  label: json['label'] as String?,
);

Map<String, dynamic> _$SaleLineToJson(SaleLine instance) => <String, dynamic>{
  'product_id': instance.productId,
  'label': instance.label,
  'quantity': instance.quantity,
  'unit_price': instance.unitPrice,
};
