// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'sale_line.dart';
import 'tap_input.dart';
import 'timestamp.dart';

part 'payment_request_body.g.dart';

/// Exactement un moyen parmi `tap_id`, `tap`, `customer_qr_token`, `payment_intent_id`. Si `lines`.
/// est présent, `amount` DOIT être égal à Σ quantity × unit_price.
/// `payment_intent_id` est V2 (ADR-43) : en V1, le serveur le refuse (`422 DEVICE_MODE_NOT_ALLOWED`).
///
@JsonSerializable()
class PaymentRequestBody {
  const PaymentRequestBody({
    required this.amount,
    required this.currency,
    required this.occurredAt,
    this.tapId,
    this.tap,
    this.customerQrToken,
    this.paymentIntentId,
    this.lines,
  });

  factory PaymentRequestBody.fromJson(Map<String, Object?> json) =>
      _$PaymentRequestBodyFromJson(json);

  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;
  @JsonKey(name: 'customer_qr_token')
  final String? customerQrToken;

  /// **V2 (ADR-43)** — intention d'un POS tiers présentée par un terminal `PAIRED_TPE`. Refusé en V1 (`422 DEVICE_MODE_NOT_ALLOWED`).
  @JsonKey(name: 'payment_intent_id')
  final String? paymentIntentId;
  final List<SaleLine>? lines;

  Map<String, Object?> toJson() => _$PaymentRequestBodyToJson(this);
}
