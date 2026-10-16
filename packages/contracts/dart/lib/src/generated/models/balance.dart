// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'balance.g.dart';

@JsonSerializable()
class Balance {
  const Balance({
    required this.spendable,
    required this.paid,
    required this.promo,
  });

  factory Balance.fromJson(Map<String, Object?> json) =>
      _$BalanceFromJson(json);

  /// Solde disponible = paid + promo (wallet_spendable).
  final int spendable;

  /// Crédits payés (WALLET_PAID), remboursables.
  final int paid;

  /// Crédits offerts (WALLET_PROMO), non remboursables.
  final int promo;

  Map<String, Object?> toJson() => _$BalanceToJson(this);
}
