// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'wallet_limits.g.dart';

@JsonSerializable()
class WalletLimits {
  const WalletLimits({
    required this.maxWalletBalance,
    required this.unidentifiedMaxBalance,
    required this.identifiedMonthlyLimit,
    required this.unidentifiedMonthlyLimit,
  });

  factory WalletLimits.fromJson(Map<String, Object?> json) =>
      _$WalletLimitsFromJson(json);

  @JsonKey(name: 'max_wallet_balance')
  final int? maxWalletBalance;
  @JsonKey(name: 'unidentified_max_balance')
  final int? unidentifiedMaxBalance;
  @JsonKey(name: 'identified_monthly_limit')
  final int? identifiedMonthlyLimit;
  @JsonKey(name: 'unidentified_monthly_limit')
  final int? unidentifiedMonthlyLimit;

  Map<String, Object?> toJson() => _$WalletLimitsToJson(this);
}
