// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_intent.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentIntent _$PaymentIntentFromJson(Map<String, dynamic> json) =>
    PaymentIntent(
      paymentIntentId: json['payment_intent_id'] as String,
      status: $enumDecode(_$PaymentIntentStatusEnumMap, json['status']),
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      captureMethod: $enumDecode(
        _$PaymentIntentCaptureMethodEnumMap,
        json['capture_method'],
      ),
      posId: json['pos_id'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      expiresAt: DateTime.parse(json['expires_at'] as String),
      amountCapturable: (json['amount_capturable'] as num?)?.toInt(),
      amountCaptured: (json['amount_captured'] as num?)?.toInt(),
      deviceId: json['device_id'] as String?,
      externalReference: json['external_reference'] as String?,
      qrPayload: json['qr_payload'] as String?,
      transactionId: json['transaction_id'] as String?,
      metadata: (json['metadata'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(k, e as String),
      ),
    );

Map<String, dynamic> _$PaymentIntentToJson(PaymentIntent instance) =>
    <String, dynamic>{
      'payment_intent_id': instance.paymentIntentId,
      'status': instance.status,
      'amount': instance.amount,
      'amount_capturable': instance.amountCapturable,
      'amount_captured': instance.amountCaptured,
      'currency': instance.currency,
      'capture_method': instance.captureMethod,
      'pos_id': instance.posId,
      'device_id': instance.deviceId,
      'external_reference': instance.externalReference,
      'qr_payload': instance.qrPayload,
      'transaction_id': instance.transactionId,
      'created_at': instance.createdAt.toIso8601String(),
      'expires_at': instance.expiresAt.toIso8601String(),
      'metadata': instance.metadata,
    };

const _$PaymentIntentStatusEnumMap = {
  PaymentIntentStatus.requiresPayment: 'REQUIRES_PAYMENT',
  PaymentIntentStatus.authorized: 'AUTHORIZED',
  PaymentIntentStatus.succeeded: 'SUCCEEDED',
  PaymentIntentStatus.cancelled: 'CANCELLED',
  PaymentIntentStatus.expired: 'EXPIRED',
  PaymentIntentStatus.failed: 'FAILED',
};

const _$PaymentIntentCaptureMethodEnumMap = {
  PaymentIntentCaptureMethod.automatic: 'AUTOMATIC',
  PaymentIntentCaptureMethod.manual: 'MANUAL',
};
