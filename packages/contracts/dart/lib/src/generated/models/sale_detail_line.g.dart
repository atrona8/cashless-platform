// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_detail_line.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaleDetailLine _$SaleDetailLineFromJson(Map<String, dynamic> json) =>
    SaleDetailLine(
      lineNo: (json['line_no'] as num).toInt(),
      itemId: json['item_id'] as String?,
      labelFr: json['label_fr'] as String,
      labelEn: json['label_en'] as String,
      quantity: (json['quantity'] as num).toInt(),
      unitPrice: (json['unit_price'] as num).toInt(),
      vatRateBps: (json['vat_rate_bps'] as num).toInt(),
      lineTotal: (json['line_total'] as num).toInt(),
    );

Map<String, dynamic> _$SaleDetailLineToJson(SaleDetailLine instance) =>
    <String, dynamic>{
      'line_no': instance.lineNo,
      'item_id': instance.itemId,
      'label_fr': instance.labelFr,
      'label_en': instance.labelEn,
      'quantity': instance.quantity,
      'unit_price': instance.unitPrice,
      'vat_rate_bps': instance.vatRateBps,
      'line_total': instance.lineTotal,
    };
