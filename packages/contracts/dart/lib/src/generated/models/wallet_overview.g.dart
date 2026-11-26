// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallet_overview.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WalletOverview _$WalletOverviewFromJson(Map<String, dynamic> json) =>
    WalletOverview(
      walletId: json['wallet_id'] as String,
      status: $enumDecode(_$WalletStatusEnumMap, json['status']),
      eventId: json['event_id'] as String,
      currency: json['currency'] as String,
      paidBalance: (json['paid_balance'] as num).toInt(),
      promoBalance: (json['promo_balance'] as num).toInt(),
      deposit: (json['deposit'] as num).toInt(),
      media: (json['media'] as List<dynamic>)
          .map((e) => Media2.fromJson(e as Map<String, dynamic>))
          .toList(),
      customerRef: json['customer_ref'] as String?,
    );

Map<String, dynamic> _$WalletOverviewToJson(WalletOverview instance) =>
    <String, dynamic>{
      'wallet_id': instance.walletId,
      'status': instance.status,
      'event_id': instance.eventId,
      'currency': instance.currency,
      'paid_balance': instance.paidBalance,
      'promo_balance': instance.promoBalance,
      'deposit': instance.deposit,
      'media': instance.media,
      'customer_ref': instance.customerRef,
    };

const _$WalletStatusEnumMap = {
  WalletStatus.active: 'ACTIVE',
  WalletStatus.blocked: 'BLOCKED',
  WalletStatus.closed: 'CLOSED',
};
