// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'wallet_status.dart';

part 'wallets.g.dart';

@JsonSerializable()
class Wallets {
  const Wallets({
    required this.walletId,
    required this.status,
    required this.paid,
    required this.promo,
    this.kycVerified,
    this.topupMonthPaid,
  });

  factory Wallets.fromJson(Map<String, Object?> json) =>
      _$WalletsFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final WalletStatus status;
  final int paid;
  final int promo;

  /// Le portefeuille est rattaché à un client identifié (`wallet_kyc_level = VERIFIED`) à la date de la.
  /// page. Choisit le palier des plafonds (`event.wallet_limits`). Absent : traiter comme non identifié.
  /// (le palier le plus strict). Usage : `createCashTopup` (`422 WALLET_LIMIT_EXCEEDED`,.
  /// `422 MONTHLY_TOPUP_LIMIT_EXCEEDED`, appliqués par `check_wallet_limits`).
  ///
  @JsonKey(name: 'kyc_verified')
  final bool? kycVerified;

  /// Total des recharges (`TOPUP`, `TOPUP_CASH`) créditées au portefeuille payé pendant le mois UTC.
  /// de `to_posting_id` (même calcul que `check_wallet_limits`). La passerelle y ajoute ses propres.
  /// recharges du mois. Usage : plafond mensuel de `createCashTopup`. Absent : traiter comme inconnu et.
  /// refuser une recharge qui dépasserait le plafond mensuel du palier le plus strict.
  ///
  @JsonKey(name: 'topup_month_paid')
  final int? topupMonthPaid;

  Map<String, Object?> toJson() => _$WalletsToJson(this);
}
