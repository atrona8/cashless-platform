// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_batch_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaBatchCreate _$MediaBatchCreateFromJson(Map<String, dynamic> json) =>
    MediaBatchCreate(
      organizerId: json['organizer_id'] as String,
      kind: $enumDecode(_$MediaBatchCreateKindEnumMap, json['kind']),
      quantity: (json['quantity'] as num).toInt(),
      keyIndex: (json['key_index'] as num).toInt(),
      keyMode:
          $enumDecodeNullable(
            _$MediaBatchCreateKeyModeEnumMap,
            json['key_mode'],
          ) ??
          MediaBatchCreateKeyMode.shared,
      reusePolicy:
          $enumDecodeNullable(
            _$MediaBatchCreateReusePolicyEnumMap,
            json['reuse_policy'],
          ) ??
          MediaBatchCreateReusePolicy.singleUse,
      eventId: json['event_id'] as String?,
      printOrderRef: json['print_order_ref'] as String?,
      preloadPromoAmount: (json['preload_promo_amount'] as num?)?.toInt(),
      depositAmount: (json['deposit_amount'] as num?)?.toInt(),
      depositMode: $enumDecodeNullable(
        _$MediaBatchCreateDepositModeEnumMap,
        json['deposit_mode'],
      ),
    );

Map<String, dynamic> _$MediaBatchCreateToJson(MediaBatchCreate instance) =>
    <String, dynamic>{
      'organizer_id': instance.organizerId,
      'event_id': instance.eventId,
      'kind': instance.kind,
      'quantity': instance.quantity,
      'key_index': instance.keyIndex,
      'key_mode': instance.keyMode,
      'reuse_policy': instance.reusePolicy,
      'print_order_ref': instance.printOrderRef,
      'preload_promo_amount': instance.preloadPromoAmount,
      'deposit_amount': instance.depositAmount,
      'deposit_mode': instance.depositMode,
    };

const _$MediaBatchCreateKindEnumMap = {
  MediaBatchCreateKind.public: 'PUBLIC',
  MediaBatchCreateKind.staff: 'STAFF',
  MediaBatchCreateKind.vip: 'VIP',
};

const _$MediaBatchCreateKeyModeEnumMap = {
  MediaBatchCreateKeyMode.shared: 'SHARED',
  MediaBatchCreateKeyMode.dedicated: 'DEDICATED',
};

const _$MediaBatchCreateReusePolicyEnumMap = {
  MediaBatchCreateReusePolicy.singleUse: 'SINGLE_USE',
  MediaBatchCreateReusePolicy.personal: 'PERSONAL',
  MediaBatchCreateReusePolicy.pool: 'POOL',
};

const _$MediaBatchCreateDepositModeEnumMap = {
  MediaBatchCreateDepositMode.fromBalance: 'FROM_BALANCE',
  MediaBatchCreateDepositMode.separate: 'SEPARATE',
};
