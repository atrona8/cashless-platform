// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'jurisdiction_profile_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

JurisdictionProfileCreate _$JurisdictionProfileCreateFromJson(
  Map<String, dynamic> json,
) => JurisdictionProfileCreate(
  validFrom: DateTime.parse(json['valid_from'] as String),
  countryCode: json['country_code'] as String?,
  minRefundWindowDays: (json['min_refund_window_days'] as num?)?.toInt(),
  breakageDestination: $enumDecodeNullable(
    _$JurisdictionProfileCreateBreakageDestinationEnumMap,
    json['breakage_destination'],
  ),
  maxWalletBalance: (json['max_wallet_balance'] as num?)?.toInt(),
  kycThreshold: (json['kyc_threshold'] as num?)?.toInt(),
  unidentifiedMaxBalance: (json['unidentified_max_balance'] as num?)?.toInt(),
  unidentifiedMonthlyLimit: (json['unidentified_monthly_limit'] as num?)
      ?.toInt(),
  identifiedMonthlyLimit: (json['identified_monthly_limit'] as num?)?.toInt(),
  lateClaimYears: (json['late_claim_years'] as num?)?.toInt(),
  rules: json['rules'],
);

Map<String, dynamic> _$JurisdictionProfileCreateToJson(
  JurisdictionProfileCreate instance,
) => <String, dynamic>{
  'country_code': instance.countryCode,
  'valid_from': instance.validFrom.toIso8601String(),
  'min_refund_window_days': instance.minRefundWindowDays,
  'breakage_destination': instance.breakageDestination,
  'max_wallet_balance': instance.maxWalletBalance,
  'kyc_threshold': instance.kycThreshold,
  'unidentified_max_balance': instance.unidentifiedMaxBalance,
  'unidentified_monthly_limit': instance.unidentifiedMonthlyLimit,
  'identified_monthly_limit': instance.identifiedMonthlyLimit,
  'late_claim_years': instance.lateClaimYears,
  'rules': instance.rules,
};

const _$JurisdictionProfileCreateBreakageDestinationEnumMap = {
  JurisdictionProfileCreateBreakageDestination.organizer: 'ORGANIZER',
  JurisdictionProfileCreateBreakageDestination.valueOperator: 'OPERATOR',
  JurisdictionProfileCreateBreakageDestination.legalAccount: 'LEGAL_ACCOUNT',
  JurisdictionProfileCreateBreakageDestination.none: 'NONE',
};
