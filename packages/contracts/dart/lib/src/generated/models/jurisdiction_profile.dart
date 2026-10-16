// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'jurisdiction_profile_breakage_destination.dart';
import 'provisional_fields.dart';

part 'jurisdiction_profile.g.dart';

/// Version d'un profil de législation (`jurisdiction_profile`, §4.1) : règles d'un pays qui bornent la.
/// configuration. Jamais modifiée ; une nouvelle version la remplace à sa date d'effet. Montants en unités.
/// mineures de la devise du pays.
///
@JsonSerializable()
class JurisdictionProfile {
  const JurisdictionProfile({
    required this.profileId,
    required this.countryCode,
    required this.version,
    required this.validFrom,
    required this.breakageDestination,
    required this.lateClaimYears,
    required this.rules,
    required this.provisionalFields,
    this.minRefundWindowDays,
    this.maxWalletBalance,
    this.kycThreshold,
    this.unidentifiedMaxBalance,
    this.unidentifiedMonthlyLimit,
    this.identifiedMonthlyLimit,
  });

  factory JurisdictionProfile.fromJson(Map<String, Object?> json) =>
      _$JurisdictionProfileFromJson(json);

  @JsonKey(name: 'profile_id')
  final String profileId;
  @JsonKey(name: 'country_code')
  final String countryCode;
  final int version;
  @JsonKey(name: 'valid_from')
  final DateTime validFrom;

  /// Délai minimal de remboursement après la fin de l'événement ; `null` = pas d'obligation.
  @JsonKey(name: 'min_refund_window_days')
  final int? minRefundWindowDays;

  /// Destination des soldes non réclamés (§5.5).
  @JsonKey(name: 'breakage_destination')
  final JurisdictionProfileBreakageDestination breakageDestination;

  /// Plafond de solde d'un client identifié ; `null` = aucun.
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

  /// Années de réclamation tardive après la clôture (ADR-67) ; 0 = casse définitive.
  @JsonKey(name: 'late_claim_years')
  final int lateClaimYears;

  /// Taxes (`taxes`), arrondis et autres règles du pays.
  final dynamic rules;

  /// Champs dont la valeur est un défaut provisoire de §17.2, à confirmer ; vide si tout a été saisi.
  @JsonKey(name: 'provisional_fields')
  final List<ProvisionalFields> provisionalFields;

  Map<String, Object?> toJson() => _$JurisdictionProfileToJson(this);
}
