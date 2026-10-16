// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_intent_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentIntentCreate _$PaymentIntentCreateFromJson(Map<String, dynamic> json) =>
    PaymentIntentCreate(
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      posId: json['pos_id'] as String,
      captureMethod:
          $enumDecodeNullable(
            _$PaymentIntentCreateCaptureMethodEnumMap,
            json['capture_method'],
          ) ??
          PaymentIntentCreateCaptureMethod.automatic,
      expiresInSeconds: (json['expires_in_seconds'] as num?)?.toInt() ?? 300,
      deviceId: json['device_id'] as String?,
      externalReference: json['external_reference'] as String?,
      metadata: (json['metadata'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(k, e as String),
      ),
    );

Map<String, dynamic> _$PaymentIntentCreateToJson(
  PaymentIntentCreate instance,
) => <String, dynamic>{
  'amount': instance.amount,
  'currency': instance.currency,
  'pos_id': instance.posId,
  'device_id': instance.deviceId,
  'capture_method': instance.captureMethod,
  'external_reference': instance.externalReference,
  'expires_in_seconds': instance.expiresInSeconds,
  'metadata': instance.metadata,
};

const _$PaymentIntentCreateCaptureMethodEnumMap = {
  PaymentIntentCreateCaptureMethod.automatic: 'AUTOMATIC',
  PaymentIntentCreateCaptureMethod.manual: 'MANUAL',
};
