// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_batch_update.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaBatchUpdate _$MediaBatchUpdateFromJson(Map<String, dynamic> json) =>
    MediaBatchUpdate(
      quantity: (json['quantity'] as num?)?.toInt(),
      printOrderRef: json['print_order_ref'] as String?,
      preloadPromoAmount: (json['preload_promo_amount'] as num?)?.toInt(),
      depositAmount: (json['deposit_amount'] as num?)?.toInt(),
      depositMode: $enumDecodeNullable(
        _$MediaBatchUpdateDepositModeEnumMap,
        json['deposit_mode'],
      ),
      reusePolicy: $enumDecodeNullable(
        _$MediaBatchUpdateReusePolicyEnumMap,
        json['reuse_policy'],
      ),
    );

Map<String, dynamic> _$MediaBatchUpdateToJson(MediaBatchUpdate instance) =>
    <String, dynamic>{
      'quantity': instance.quantity,
      'print_order_ref': instance.printOrderRef,
      'preload_promo_amount': instance.preloadPromoAmount,
      'deposit_amount': instance.depositAmount,
      'deposit_mode': instance.depositMode,
      'reuse_policy': instance.reusePolicy,
    };

const _$MediaBatchUpdateDepositModeEnumMap = {
  MediaBatchUpdateDepositMode.fromBalance: 'FROM_BALANCE',
  MediaBatchUpdateDepositMode.separate: 'SEPARATE',
};

const _$MediaBatchUpdateReusePolicyEnumMap = {
  MediaBatchUpdateReusePolicy.singleUse: 'SINGLE_USE',
  MediaBatchUpdateReusePolicy.personal: 'PERSONAL',
  MediaBatchUpdateReusePolicy.pool: 'POOL',
};
