// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cash_topup_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CashTopupRequest _$CashTopupRequestFromJson(Map<String, dynamic> json) =>
    CashTopupRequest(
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      occurredAt: DateTime.parse(json['occurred_at'] as String),
      tapId: (json['tap_id'] as num?)?.toInt(),
      tap: json['tap'] == null
          ? null
          : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
      cashTendered: (json['cash_tendered'] as num?)?.toInt(),
      cashSessionId: json['cash_session_id'] as String?,
    );

Map<String, dynamic> _$CashTopupRequestToJson(CashTopupRequest instance) =>
    <String, dynamic>{
      'amount': instance.amount,
      'currency': instance.currency,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'tap_id': instance.tapId,
      'tap': instance.tap,
      'cash_tendered': instance.cashTendered,
      'cash_session_id': instance.cashSessionId,
    };
