// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallet.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Wallet _$WalletFromJson(Map<String, dynamic> json) => Wallet(
  walletId: json['wallet_id'] as String,
  status: $enumDecode(_$WalletStatusEnumMap, json['status']),
  kycLevel: $enumDecode(_$WalletKycLevelEnumMap, json['kyc_level']),
  currency: json['currency'] as String,
  event: Event2.fromJson(json['event'] as Map<String, dynamic>),
  balance: Balance.fromJson(json['balance'] as Map<String, dynamic>),
  balanceAsOf: DateTime.parse(json['balance_as_of'] as String),
  media: (json['media'] as List<dynamic>)
      .map((e) => CustomerMedia.fromJson(e as Map<String, dynamic>))
      .toList(),
  refund: Refund.fromJson(json['refund'] as Map<String, dynamic>),
  pendingOfflineNotice: json['pending_offline_notice'] as bool?,
);

Map<String, dynamic> _$WalletToJson(Wallet instance) => <String, dynamic>{
  'wallet_id': instance.walletId,
  'status': instance.status,
  'kyc_level': instance.kycLevel,
  'currency': instance.currency,
  'event': instance.event,
  'balance': instance.balance,
  'balance_as_of': instance.balanceAsOf.toIso8601String(),
  'pending_offline_notice': instance.pendingOfflineNotice,
  'media': instance.media,
  'refund': instance.refund,
};

const _$WalletStatusEnumMap = {
  WalletStatus.active: 'ACTIVE',
  WalletStatus.blocked: 'BLOCKED',
  WalletStatus.closed: 'CLOSED',
};

const _$WalletKycLevelEnumMap = {
  WalletKycLevel.none: 'NONE',
  WalletKycLevel.verified: 'VERIFIED',
};
