// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'jurisdiction_profile_create_breakage_destination.dart';

part 'jurisdiction_profile_create.g.dart';

/// Contenu d'une version de profil. `country_code` est obligatoire à la création du profil d'un pays et ignoré.
/// pour une nouvelle version (pays du profil du chemin). Un champ omis prend son défaut provisoire (§17.2).
///
@JsonSerializable()
class JurisdictionProfileCreate {
  const JurisdictionProfileCreate({
    required this.validFrom,
    this.countryCode,
    this.minRefundWindowDays,
    this.breakageDestination,
    this.maxWalletBalance,
    this.kycThreshold,
    this.unidentifiedMaxBalance,
    this.unidentifiedMonthlyLimit,
    this.identifiedMonthlyLimit,
    this.lateClaimYears,
    this.rules,
  });

  factory JurisdictionProfileCreate.fromJson(Map<String, Object?> json) =>
      _$JurisdictionProfileCreateFromJson(json);

  @JsonKey(name: 'country_code')
  final String? countryCode;
  @JsonKey(name: 'valid_from')
  final DateTime validFrom;
  @JsonKey(name: 'min_refund_window_days')
  final int? minRefundWindowDays;
  @JsonKey(name: 'breakage_destination')
  final JurisdictionProfileCreateBreakageDestination? breakageDestination;
  @JsonKey(name: 'max_wallet_balance')
  final int? maxWalletBalance;
  @JsonKey(name: 'kyc_threshold')
  final int? kycThreshold;
  @JsonKey(name: 'unidentified_max_balance')
  final int? unidentifiedMaxBalance;
  @JsonKey(name: 'unidentified_monthly_limit')
  final int? unidentifiedMonthlyLimit;
  @JsonKey(name: 'identified_monthly_limit')
  final int? identifiedMonthlyLimit;
  @JsonKey(name: 'late_claim_years')
  final int? lateClaimYears;
  final dynamic rules;

  Map<String, Object?> toJson() => _$JurisdictionProfileCreateToJson(this);
}
