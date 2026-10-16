// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'payment_intents_payment_intent_id_capture_request_body.g.dart';

@JsonSerializable()
class PaymentIntentsPaymentIntentIdCaptureRequestBody {
  const PaymentIntentsPaymentIntentIdCaptureRequestBody({this.amountToCapture});

  factory PaymentIntentsPaymentIntentIdCaptureRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$PaymentIntentsPaymentIntentIdCaptureRequestBodyFromJson(json);

  @JsonKey(name: 'amount_to_capture')
  final Amount? amountToCapture;

  Map<String, Object?> toJson() =>
      _$PaymentIntentsPaymentIntentIdCaptureRequestBodyToJson(this);
}
