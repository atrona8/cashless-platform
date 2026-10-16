// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'reason2.dart';

part 'payment_intents_payment_intent_id_cancel_request_body.g.dart';

@JsonSerializable()
class PaymentIntentsPaymentIntentIdCancelRequestBody {
  const PaymentIntentsPaymentIntentIdCancelRequestBody({this.reason});

  factory PaymentIntentsPaymentIntentIdCancelRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$PaymentIntentsPaymentIntentIdCancelRequestBodyFromJson(json);

  final Reason2? reason;

  Map<String, Object?> toJson() =>
      _$PaymentIntentsPaymentIntentIdCancelRequestBodyToJson(this);
}
