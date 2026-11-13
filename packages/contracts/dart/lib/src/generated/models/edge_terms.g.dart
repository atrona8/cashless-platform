// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_terms.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeTerms _$EdgeTermsFromJson(Map<String, dynamic> json) => EdgeTerms(
  maxCashTopup: (json['max_cash_topup'] as num?)?.toInt(),
  activationFee: (json['activation_fee'] as num?)?.toInt(),
  spendOrder: $enumDecodeNullable(_$SpendOrderEnumMap, json['spend_order']),
  depositBatches: (json['deposit_batches'] as List<dynamic>?)
      ?.map((e) => DepositBatches.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$EdgeTermsToJson(EdgeTerms instance) => <String, dynamic>{
  'max_cash_topup': instance.maxCashTopup,
  'activation_fee': instance.activationFee,
  'spend_order': instance.spendOrder,
  'deposit_batches': instance.depositBatches,
};

const _$SpendOrderEnumMap = {
  SpendOrder.promoFirst: 'PROMO_FIRST',
  SpendOrder.paidFirst: 'PAID_FIRST',
};
