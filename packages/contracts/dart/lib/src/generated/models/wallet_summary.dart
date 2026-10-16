// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'wallet_status.dart';

part 'wallet_summary.g.dart';

@JsonSerializable()
class WalletSummary {
  const WalletSummary({
    required this.walletId,
    required this.status,
    required this.currency,
    required this.spendable,
    required this.paid,
    required this.promo,
  });

  factory WalletSummary.fromJson(Map<String, Object?> json) =>
      _$WalletSummaryFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final WalletStatus status;
  final Currency currency;
  final int spendable;
  final int paid;
  final int promo;

  Map<String, Object?> toJson() => _$WalletSummaryToJson(this);
}
