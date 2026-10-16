// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallet_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WalletSummary _$WalletSummaryFromJson(Map<String, dynamic> json) =>
    WalletSummary(
      walletId: json['wallet_id'] as String,
      status: $enumDecode(_$WalletStatusEnumMap, json['status']),
      currency: json['currency'] as String,
      spendable: (json['spendable'] as num).toInt(),
      paid: (json['paid'] as num).toInt(),
      promo: (json['promo'] as num).toInt(),
    );

Map<String, dynamic> _$WalletSummaryToJson(WalletSummary instance) =>
    <String, dynamic>{
      'wallet_id': instance.walletId,
      'status': instance.status,
      'currency': instance.currency,
      'spendable': instance.spendable,
      'paid': instance.paid,
      'promo': instance.promo,
    };

const _$WalletStatusEnumMap = {
  WalletStatus.active: 'ACTIVE',
  WalletStatus.blocked: 'BLOCKED',
  WalletStatus.closed: 'CLOSED',
};
