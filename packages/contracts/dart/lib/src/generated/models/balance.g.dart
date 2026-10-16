// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'balance.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Balance _$BalanceFromJson(Map<String, dynamic> json) => Balance(
  spendable: (json['spendable'] as num).toInt(),
  paid: (json['paid'] as num).toInt(),
  promo: (json['promo'] as num).toInt(),
);

Map<String, dynamic> _$BalanceToJson(Balance instance) => <String, dynamic>{
  'spendable': instance.spendable,
  'paid': instance.paid,
  'promo': instance.promo,
};
