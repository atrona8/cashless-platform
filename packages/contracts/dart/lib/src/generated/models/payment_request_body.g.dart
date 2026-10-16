// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentRequestBody _$PaymentRequestBodyFromJson(Map<String, dynamic> json) =>
    PaymentRequestBody(
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      occurredAt: DateTime.parse(json['occurred_at'] as String),
      tapId: (json['tap_id'] as num?)?.toInt(),
      tap: json['tap'] == null
          ? null
          : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
      customerQrToken: json['customer_qr_token'] as String?,
      paymentIntentId: json['payment_intent_id'] as String?,
      lines: (json['lines'] as List<dynamic>?)
          ?.map((e) => SaleLine.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$PaymentRequestBodyToJson(PaymentRequestBody instance) =>
    <String, dynamic>{
      'amount': instance.amount,
      'currency': instance.currency,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'tap_id': instance.tapId,
      'tap': instance.tap,
      'customer_qr_token': instance.customerQrToken,
      'payment_intent_id': instance.paymentIntentId,
      'lines': instance.lines,
    };
