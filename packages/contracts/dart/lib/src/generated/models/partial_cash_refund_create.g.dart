// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'partial_cash_refund_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PartialCashRefundCreate _$PartialCashRefundCreateFromJson(
  Map<String, dynamic> json,
) => PartialCashRefundCreate(
  amount: (json['amount'] as num).toInt(),
  tapId: (json['tap_id'] as num?)?.toInt(),
  tap: json['tap'] == null
      ? null
      : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
);

Map<String, dynamic> _$PartialCashRefundCreateToJson(
  PartialCashRefundCreate instance,
) => <String, dynamic>{
  'tap_id': instance.tapId,
  'tap': instance.tap,
  'amount': instance.amount,
};
