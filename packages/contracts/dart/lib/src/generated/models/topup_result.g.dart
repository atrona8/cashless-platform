// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'topup_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TopupResult _$TopupResultFromJson(Map<String, dynamic> json) => TopupResult(
  transactionId: json['transaction_id'] as String,
  idempotencyKey: json['idempotency_key'] as String,
  type: $enumDecode(_$TopupResultTypeEnumMap, json['type']),
  status: $enumDecode(_$TopupResultStatusEnumMap, json['status']),
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  walletId: json['wallet_id'] as String,
  balanceAfter: Balance.fromJson(json['balance_after'] as Map<String, dynamic>),
  deposit: json['deposit'] == null
      ? null
      : DepositState.fromJson(json['deposit'] as Map<String, dynamic>),
);

Map<String, dynamic> _$TopupResultToJson(TopupResult instance) =>
    <String, dynamic>{
      'transaction_id': instance.transactionId,
      'idempotency_key': instance.idempotencyKey,
      'type': instance.type,
      'status': instance.status,
      'amount': instance.amount,
      'currency': instance.currency,
      'wallet_id': instance.walletId,
      'balance_after': instance.balanceAfter,
      'deposit': instance.deposit,
    };

const _$TopupResultTypeEnumMap = {
  TopupResultType.topupCash: 'TOPUP_CASH',
  TopupResultType.topup: 'TOPUP',
};

const _$TopupResultStatusEnumMap = {TopupResultStatus.succeeded: 'SUCCEEDED'};
