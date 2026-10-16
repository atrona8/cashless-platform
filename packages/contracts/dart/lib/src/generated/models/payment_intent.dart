// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'payment_intent_capture_method.dart';
import 'payment_intent_status.dart';
import 'timestamp.dart';

part 'payment_intent.g.dart';

@JsonSerializable()
class PaymentIntent {
  const PaymentIntent({
    required this.paymentIntentId,
    required this.status,
    required this.amount,
    required this.currency,
    required this.captureMethod,
    required this.posId,
    required this.createdAt,
    required this.expiresAt,
    this.amountCapturable,
    this.amountCaptured,
    this.deviceId,
    this.externalReference,
    this.qrPayload,
    this.transactionId,
    this.metadata,
  });

  factory PaymentIntent.fromJson(Map<String, Object?> json) =>
      _$PaymentIntentFromJson(json);

  @JsonKey(name: 'payment_intent_id')
  final String paymentIntentId;
  final PaymentIntentStatus status;
  final Amount amount;
  @JsonKey(name: 'amount_capturable')
  final int? amountCapturable;
  @JsonKey(name: 'amount_captured')
  final int? amountCaptured;
  final Currency currency;
  @JsonKey(name: 'capture_method')
  final PaymentIntentCaptureMethod captureMethod;
  @JsonKey(name: 'pos_id')
  final String posId;
  @JsonKey(name: 'device_id')
  final String? deviceId;
  @JsonKey(name: 'external_reference')
  final String? externalReference;
  @JsonKey(name: 'qr_payload')
  final String? qrPayload;
  @JsonKey(name: 'transaction_id')
  final String? transactionId;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;
  final Map<String, String>? metadata;

  Map<String, Object?> toJson() => _$PaymentIntentToJson(this);
}
