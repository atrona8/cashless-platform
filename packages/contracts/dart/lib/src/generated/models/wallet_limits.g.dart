// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallet_limits.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WalletLimits _$WalletLimitsFromJson(Map<String, dynamic> json) => WalletLimits(
  maxWalletBalance: (json['max_wallet_balance'] as num?)?.toInt(),
  unidentifiedMaxBalance: (json['unidentified_max_balance'] as num?)?.toInt(),
  identifiedMonthlyLimit: (json['identified_monthly_limit'] as num?)?.toInt(),
  unidentifiedMonthlyLimit: (json['unidentified_monthly_limit'] as num?)
      ?.toInt(),
);

Map<String, dynamic> _$WalletLimitsToJson(WalletLimits instance) =>
    <String, dynamic>{
      'max_wallet_balance': instance.maxWalletBalance,
      'unidentified_max_balance': instance.unidentifiedMaxBalance,
      'identified_monthly_limit': instance.identifiedMonthlyLimit,
      'unidentified_monthly_limit': instance.unidentifiedMonthlyLimit,
    };
