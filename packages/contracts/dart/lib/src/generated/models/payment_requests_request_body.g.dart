// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_requests_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentRequestsRequestBody _$PaymentRequestsRequestBodyFromJson(
  Map<String, dynamic> json,
) => PaymentRequestsRequestBody(
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  lines: (json['lines'] as List<dynamic>?)
      ?.map((e) => SaleLine.fromJson(e as Map<String, dynamic>))
      .toList(),
  ttlSeconds: (json['ttl_seconds'] as num?)?.toInt() ?? 60,
);

Map<String, dynamic> _$PaymentRequestsRequestBodyToJson(
  PaymentRequestsRequestBody instance,
) => <String, dynamic>{
  'amount': instance.amount,
  'currency': instance.currency,
  'ttl_seconds': instance.ttlSeconds,
  'lines': instance.lines,
};
