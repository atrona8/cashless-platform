// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'payment_intent_create_capture_method.dart';

part 'payment_intent_create.g.dart';

@JsonSerializable()
class PaymentIntentCreate {
  const PaymentIntentCreate({
    required this.amount,
    required this.currency,
    required this.posId,
    this.captureMethod = PaymentIntentCreateCaptureMethod.automatic,
    this.expiresInSeconds = 300,
    this.deviceId,
    this.externalReference,
    this.metadata,
  });

  factory PaymentIntentCreate.fromJson(Map<String, Object?> json) =>
      _$PaymentIntentCreateFromJson(json);

  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'pos_id')
  final String posId;

  /// Terminal PAIRED_TPE qui présentera l'intention ; absent = paiement par QR seulement.
  @JsonKey(name: 'device_id')
  final String? deviceId;
  @JsonKey(name: 'capture_method')
  final PaymentIntentCreateCaptureMethod captureMethod;
  @JsonKey(name: 'external_reference')
  final String? externalReference;
  @JsonKey(name: 'expires_in_seconds')
  final int expiresInSeconds;
  final Map<String, String>? metadata;

  Map<String, Object?> toJson() => _$PaymentIntentCreateToJson(this);
}
