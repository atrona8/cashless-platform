// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'jurisdiction_profile.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

JurisdictionProfile _$JurisdictionProfileFromJson(
  Map<String, dynamic> json,
) => JurisdictionProfile(
  profileId: json['profile_id'] as String,
  countryCode: json['country_code'] as String,
  version: (json['version'] as num).toInt(),
  validFrom: DateTime.parse(json['valid_from'] as String),
  breakageDestination: $enumDecode(
    _$JurisdictionProfileBreakageDestinationEnumMap,
    json['breakage_destination'],
  ),
  lateClaimYears: (json['late_claim_years'] as num).toInt(),
  rules: json['rules'],
  provisionalFields: (json['provisional_fields'] as List<dynamic>)
      .map((e) => ProvisionalFields.fromJson(e as Map<String, dynamic>))
      .toList(),
  minRefundWindowDays: (json['min_refund_window_days'] as num?)?.toInt(),
  maxWalletBalance: (json['max_wallet_balance'] as num?)?.toInt(),
  kycThreshold: (json['kyc_threshold'] as num?)?.toInt(),
  unidentifiedMaxBalance: (json['unidentified_max_balance'] as num?)?.toInt(),
  unidentifiedMonthlyLimit: (json['unidentified_monthly_limit'] as num?)
      ?.toInt(),
  identifiedMonthlyLimit: (json['identified_monthly_limit'] as num?)?.toInt(),
);

Map<String, dynamic> _$JurisdictionProfileToJson(
  JurisdictionProfile instance,
) => <String, dynamic>{
  'profile_id': instance.profileId,
  'country_code': instance.countryCode,
  'version': instance.version,
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
  'provisional_fields': instance.provisionalFields,
};

const _$JurisdictionProfileBreakageDestinationEnumMap = {
  JurisdictionProfileBreakageDestination.organizer: 'ORGANIZER',
  JurisdictionProfileBreakageDestination.valueOperator: 'OPERATOR',
  JurisdictionProfileBreakageDestination.legalAccount: 'LEGAL_ACCOUNT',
  JurisdictionProfileBreakageDestination.none: 'NONE',
};
