// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'deposit_batches.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DepositBatches _$DepositBatchesFromJson(Map<String, dynamic> json) =>
    DepositBatches(
      batchId: json['batch_id'] as String,
      depositAmount: (json['deposit_amount'] as num).toInt(),
      depositMode: $enumDecodeNullable(
        _$DepositModeEnumMap,
        json['deposit_mode'],
      ),
    );

Map<String, dynamic> _$DepositBatchesToJson(DepositBatches instance) =>
    <String, dynamic>{
      'batch_id': instance.batchId,
      'deposit_amount': instance.depositAmount,
      'deposit_mode': instance.depositMode,
    };

const _$DepositModeEnumMap = {
  DepositMode.fromBalance: 'FROM_BALANCE',
  DepositMode.separate: 'SEPARATE',
  DepositMode.valueNull: null,
};
