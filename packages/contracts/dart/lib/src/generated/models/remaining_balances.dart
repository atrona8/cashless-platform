// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';

part 'remaining_balances.g.dart';

/// Soldes restants des portefeuilles d'un événement, par nature. Le détail par portefeuille est en CSV.
@JsonSerializable()
class RemainingBalances {
  const RemainingBalances({
    required this.eventId,
    required this.currency,
    required this.asOf,
    required this.walletCount,
    required this.paidTotal,
    required this.cashDueTotal,
    required this.promoTotal,
  });

  factory RemainingBalances.fromJson(Map<String, Object?> json) =>
      _$RemainingBalancesFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final Currency currency;
  @JsonKey(name: 'as_of')
  final DateTime asOf;

  /// Portefeuilles à solde non nul.
  @JsonKey(name: 'wallet_count')
  final int walletCount;
  @JsonKey(name: 'paid_total')
  final int paidTotal;
  @JsonKey(name: 'cash_due_total')
  final int cashDueTotal;
  @JsonKey(name: 'promo_total')
  final int promoTotal;

  Map<String, Object?> toJson() => _$RemainingBalancesToJson(this);
}
