// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'balance.dart';
import 'currency.dart';
import 'payment_result_channel.dart';
import 'payment_result_status.dart';
import 'sale_line_result.dart';
import 'sale_vendor.dart';
import 'timestamp.dart';
import 'transaction_type.dart';

part 'payment_result.g.dart';

@JsonSerializable()
class PaymentResult {
  const PaymentResult({
    required this.transactionId,
    required this.idempotencyKey,
    required this.type,
    required this.status,
    required this.amount,
    required this.currency,
    required this.occurredAt,
    required this.recordedAt,
    required this.balanceAfter,
    this.reversesId,
    this.mediaId,
    this.walletId,
    this.receiptNumber,
    this.vendor,
    this.lines,
    this.channel,
  });

  factory PaymentResult.fromJson(Map<String, Object?> json) =>
      _$PaymentResultFromJson(json);

  @JsonKey(name: 'transaction_id')
  final String transactionId;
  @JsonKey(name: 'idempotency_key')
  final String idempotencyKey;
  final TransactionType type;
  final PaymentResultStatus status;
  @JsonKey(name: 'reverses_id')
  final String? reversesId;
  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  @JsonKey(name: 'recorded_at')
  final Timestamp recordedAt;
  @JsonKey(name: 'media_id')
  final String? mediaId;
  @JsonKey(name: 'wallet_id')
  final String? walletId;
  @JsonKey(name: 'balance_after')
  final Balance balanceAfter;
  @JsonKey(name: 'receipt_number')
  final String? receiptNumber;
  final SaleVendor? vendor;

  /// Lignes enregistrées de la vente (copiées du catalogue) ; absent sans lignes.
  final List<SaleLineResult>? lines;

  /// Canal de la vente (bracelet, QR commerçant, QR client) ; absent hors vente.
  final PaymentResultChannel? channel;

  Map<String, Object?> toJson() => _$PaymentResultToJson(this);
}
