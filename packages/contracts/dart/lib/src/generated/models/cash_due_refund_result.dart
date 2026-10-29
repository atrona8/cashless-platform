// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';

part 'cash_due_refund_result.g.dart';

@JsonSerializable()
class CashDueRefundResult {
  const CashDueRefundResult({
    required this.transactionId,
    required this.idempotencyKey,
    required this.mediaId,
    required this.amount,
    required this.currency,
    required this.resolvedAnomalyIds,
    this.approvedBy,
    this.cashSessionId,
  });

  factory CashDueRefundResult.fromJson(Map<String, Object?> json) =>
      _$CashDueRefundResultFromJson(json);

  /// Transaction `WALLET_REFUND` (débit `L-ESP-A-RENDRE`, crédit caisse).
  @JsonKey(name: 'transaction_id')
  final String transactionId;
  @JsonKey(name: 'idempotency_key')
  final String idempotencyKey;
  @JsonKey(name: 'media_id')
  final String mediaId;
  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'resolved_anomaly_ids')
  final List<String> resolvedAnomalyIds;

  /// Valideur (`sub` du jeton d'approbation sur place), ou null sous le plafond.
  @JsonKey(name: 'approved_by')
  final String? approvedBy;

  /// Session de caisse dont le compte a été crédité.
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$CashDueRefundResultToJson(this);
}
