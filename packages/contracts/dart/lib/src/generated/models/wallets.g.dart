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
);

Map<String, dynamic> _$WalletsToJson(Wallets instance) => <String, dynamic>{
  'wallet_id': instance.walletId,
  'status': instance.status,
  'paid': instance.paid,
  'promo': instance.promo,
};

const _$WalletStatusEnumMap = {
  WalletStatus.active: 'ACTIVE',
  WalletStatus.blocked: 'BLOCKED',
  WalletStatus.closed: 'CLOSED',
};
