// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'partial_cash_refund.g.dart';

/// Rendu partiel en espèces. Montants en unités mineures.
@JsonSerializable()
class PartialCashRefund {
  const PartialCashRefund({
    required this.transactionId,
    required this.mediaId,
    required this.walletId,
    required this.amountDebited,
    required this.fee,
    required this.cashHanded,
    required this.paidBalanceAfter,
    required this.dayCumulative,
    required this.approvedBy,
    required this.cashSessionId,
  });

  factory PartialCashRefund.fromJson(Map<String, Object?> json) =>
      _$PartialCashRefundFromJson(json);

  @JsonKey(name: 'transaction_id')
  final String transactionId;
  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'wallet_id')
  final String walletId;

  /// Montant débité du solde payé (brut).
  @JsonKey(name: 'amount_debited')
  final int amountDebited;

  /// Frais retenus (`refund_policy`).
  final int fee;

  /// Espèces remises, soit le montant débité moins les frais.
  @JsonKey(name: 'cash_handed')
  final int cashHanded;

  /// Solde payé du portefeuille après le rendu.
  @JsonKey(name: 'paid_balance_after')
  final int paidBalanceAfter;

  /// Cumul du jour UTC des rendus partiels du portefeuille, ce rendu compris.
  @JsonKey(name: 'day_cumulative')
  final int dayCumulative;

  /// Seconde personne (`sub` du jeton d'approbation) ; null si elle n'était pas requise.
  @JsonKey(name: 'approved_by')
  final String? approvedBy;
  @JsonKey(name: 'cash_session_id')
  final String cashSessionId;

  Map<String, Object?> toJson() => _$PartialCashRefundToJson(this);
}
