// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';

part 'late_claim_result.g.dart';

@JsonSerializable()
class LateClaimResult {
  const LateClaimResult({
    required this.ledgerId,
    required this.walletId,
    required this.amount,
    required this.currency,
    required this.breakageReversalTransactionId,
    required this.walletRefundTransactionId,
    required this.approvedBy,
  });

  factory LateClaimResult.fromJson(Map<String, Object?> json) =>
      _$LateClaimResultFromJson(json);

  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  @JsonKey(name: 'wallet_id')
  final String walletId;
  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'breakage_reversal_transaction_id')
  final String breakageReversalTransactionId;
  @JsonKey(name: 'wallet_refund_transaction_id')
  final String walletRefundTransactionId;

  /// Valideur (`decided_by` de la demande d'approbation).
  @JsonKey(name: 'approved_by')
  final String approvedBy;

  Map<String, Object?> toJson() => _$LateClaimResultToJson(this);
}
