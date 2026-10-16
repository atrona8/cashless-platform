// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_intents_payment_intent_id_cancel_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentIntentsPaymentIntentIdCancelRequestBody
_$PaymentIntentsPaymentIntentIdCancelRequestBodyFromJson(
  Map<String, dynamic> json,
) => PaymentIntentsPaymentIntentIdCancelRequestBody(
  reason: $enumDecodeNullable(_$Reason2EnumMap, json['reason']),
);

Map<String, dynamic> _$PaymentIntentsPaymentIntentIdCancelRequestBodyToJson(
  PaymentIntentsPaymentIntentIdCancelRequestBody instance,
) => <String, dynamic>{'reason': instance.reason};

const _$Reason2EnumMap = {
  Reason2.requestedByCustomer: 'REQUESTED_BY_CUSTOMER',
  Reason2.duplicate: 'DUPLICATE',
  Reason2.abandoned: 'ABANDONED',
  Reason2.inputError: 'INPUT_ERROR',
};
