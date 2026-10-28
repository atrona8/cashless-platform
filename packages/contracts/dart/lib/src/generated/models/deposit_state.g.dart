// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'deposit_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DepositState _$DepositStateFromJson(Map<String, dynamic> json) => DepositState(
  status: $enumDecode(_$DepositStatusEnumMap, json['status']),
  amount: (json['amount'] as num).toInt(),
  mode: $enumDecodeNullable(_$DepositStateModeEnumMap, json['mode']),
  transactionId: json['transaction_id'] as String?,
  cashSessionId: json['cash_session_id'] as String?,
);

Map<String, dynamic> _$DepositStateToJson(DepositState instance) =>
    <String, dynamic>{
      'status': instance.status,
      'amount': instance.amount,
      'mode': instance.mode,
      'transaction_id': instance.transactionId,
      'cash_session_id': instance.cashSessionId,
    };

const _$DepositStatusEnumMap = {
  DepositStatus.none: 'NONE',
  DepositStatus.due: 'DUE',
  DepositStatus.held: 'HELD',
  DepositStatus.refunded: 'REFUNDED',
  DepositStatus.forfeited: 'FORFEITED',
};

const _$DepositStateModeEnumMap = {
  DepositStateMode.fromBalance: 'FROM_BALANCE',
  DepositStateMode.separate: 'SEPARATE',
  DepositStateMode.valueNull: null,
};
