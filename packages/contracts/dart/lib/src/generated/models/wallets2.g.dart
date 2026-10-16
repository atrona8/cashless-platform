// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallets2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Wallets2 _$Wallets2FromJson(Map<String, dynamic> json) => Wallets2(
  walletId: json['wallet_id'] as String,
  currency: json['currency'] as String,
  spendable: (json['spendable'] as num).toInt(),
  attachedToAccount: json['attached_to_account'] as bool,
);

Map<String, dynamic> _$Wallets2ToJson(Wallets2 instance) => <String, dynamic>{
  'wallet_id': instance.walletId,
  'currency': instance.currency,
  'spendable': instance.spendable,
  'attached_to_account': instance.attachedToAccount,
};
