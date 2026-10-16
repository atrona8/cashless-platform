// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'payment_request_object_direction.dart';
import 'payment_request_object_status.dart';
import 'timestamp.dart';

part 'payment_request_object.g.dart';

@JsonSerializable()
class PaymentRequestObject {
  const PaymentRequestObject({
    required this.paymentRequestId,
    required this.direction,
    required this.status,
    required this.currency,
    required this.expiresAt,
    this.amount,
    this.merchantName,
    this.qrPayload,
    this.transactionId,
  });

  factory PaymentRequestObject.fromJson(Map<String, Object?> json) =>
      _$PaymentRequestObjectFromJson(json);

  @JsonKey(name: 'payment_request_id')
  final String paymentRequestId;
  final PaymentRequestObjectDirection direction;
  final PaymentRequestObjectStatus status;
  final int? amount;
  final Currency currency;
  @JsonKey(name: 'merchant_name')
  final String? merchantName;

  /// Renvoyé uniquement à la création (contient le jeton).
  @JsonKey(name: 'qr_payload')
  final String? qrPayload;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  Map<String, Object?> toJson() => _$PaymentRequestObjectToJson(this);
}
