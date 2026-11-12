// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallets.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Wallets _$WalletsFromJson(Map<String, dynamic> json) => Wallets(
  walletId: json['wallet_id'] as String,
  status: $enumDecode(_$WalletStatusEnumMap, json['status']),
  paid: (json['paid'] as num).toInt(),
  promo: (json['promo'] as num).toInt(),
  kycVerified: json['kyc_verified'] as bool?,
  topupMonthPaid: (json['topup_month_paid'] as num?)?.toInt(),
);

Map<String, dynamic> _$WalletsToJson(Wallets instance) => <String, dynamic>{
  'wallet_id': instance.walletId,
  'status': instance.status,
  'paid': instance.paid,
  'promo': instance.promo,
  'kyc_verified': instance.kycVerified,
  'topup_month_paid': instance.topupMonthPaid,
};

const _$WalletStatusEnumMap = {
  WalletStatus.active: 'ACTIVE',
  WalletStatus.blocked: 'BLOCKED',
  WalletStatus.closed: 'CLOSED',
};
