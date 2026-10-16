// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cash_due_refund_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CashDueRefundRequest _$CashDueRefundRequestFromJson(
  Map<String, dynamic> json,
) => CashDueRefundRequest(
  tapId: (json['tap_id'] as num?)?.toInt(),
  tap: json['tap'] == null
      ? null
      : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
  cashSessionId: json['cash_session_id'] as String?,
);

Map<String, dynamic> _$CashDueRefundRequestToJson(
  CashDueRefundRequest instance,
) => <String, dynamic>{
  'tap_id': instance.tapId,
  'tap': instance.tap,
  'cash_session_id': instance.cashSessionId,
};
