// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'remaining_balances.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RemainingBalances _$RemainingBalancesFromJson(Map<String, dynamic> json) =>
    RemainingBalances(
      eventId: json['event_id'] as String,
      currency: json['currency'] as String,
      asOf: DateTime.parse(json['as_of'] as String),
      walletCount: (json['wallet_count'] as num).toInt(),
      paidTotal: (json['paid_total'] as num).toInt(),
      cashDueTotal: (json['cash_due_total'] as num).toInt(),
      promoTotal: (json['promo_total'] as num).toInt(),
    );

Map<String, dynamic> _$RemainingBalancesToJson(RemainingBalances instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'currency': instance.currency,
      'as_of': instance.asOf.toIso8601String(),
      'wallet_count': instance.walletCount,
      'paid_total': instance.paidTotal,
      'cash_due_total': instance.cashDueTotal,
      'promo_total': instance.promoTotal,
    };
