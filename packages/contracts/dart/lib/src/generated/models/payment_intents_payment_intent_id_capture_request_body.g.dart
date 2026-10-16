// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_intents_payment_intent_id_capture_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentIntentsPaymentIntentIdCaptureRequestBody
_$PaymentIntentsPaymentIntentIdCaptureRequestBodyFromJson(
  Map<String, dynamic> json,
) => PaymentIntentsPaymentIntentIdCaptureRequestBody(
  amountToCapture: (json['amount_to_capture'] as num?)?.toInt(),
);

Map<String, dynamic> _$PaymentIntentsPaymentIntentIdCaptureRequestBodyToJson(
  PaymentIntentsPaymentIntentIdCaptureRequestBody instance,
) => <String, dynamic>{'amount_to_capture': instance.amountToCapture};
