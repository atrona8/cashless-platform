// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_batch.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaBatch _$MediaBatchFromJson(Map<String, dynamic> json) => MediaBatch(
  batchId: json['batch_id'] as String,
  operatorId: json['operator_id'] as String,
  organizerId: json['organizer_id'] as String,
  kind: $enumDecode(_$MediaBatchKindEnumMap, json['kind']),
  quantity: (json['quantity'] as num).toInt(),
  keyIndex: (json['key_index'] as num).toInt(),
  keyMode: $enumDecode(_$MediaBatchKeyModeEnumMap, json['key_mode']),
  reusePolicy: $enumDecode(
    _$MediaBatchReusePolicyEnumMap,
    json['reuse_policy'],
  ),
  status: $enumDecode(_$MediaBatchStatusEnumMap, json['status']),
  preloadPromoAmount: (json['preload_promo_amount'] as num).toInt(),
  depositAmount: (json['deposit_amount'] as num).toInt(),
  claimCodesIssued: json['claim_codes_issued'] as bool,
  createdAt: DateTime.parse(json['created_at'] as String),
  eventId: json['event_id'] as String?,
  printOrderRef: json['print_order_ref'] as String?,
  depositMode: $enumDecodeNullable(
    _$MediaBatchDepositModeEnumMap,
    json['deposit_mode'],
  ),
);

Map<String, dynamic> _$MediaBatchToJson(MediaBatch instance) =>
    <String, dynamic>{
      'batch_id': instance.batchId,
      'operator_id': instance.operatorId,
      'organizer_id': instance.organizerId,
      'event_id': instance.eventId,
      'kind': instance.kind,
      'quantity': instance.quantity,
      'key_index': instance.keyIndex,
      'key_mode': instance.keyMode,
      'reuse_policy': instance.reusePolicy,
      'print_order_ref': instance.printOrderRef,
      'status': instance.status,
      'preload_promo_amount': instance.preloadPromoAmount,
      'deposit_amount': instance.depositAmount,
      'deposit_mode': instance.depositMode,
      'claim_codes_issued': instance.claimCodesIssued,
      'created_at': instance.createdAt.toIso8601String(),
    };

const _$MediaBatchKindEnumMap = {
  MediaBatchKind.public: 'PUBLIC',
  MediaBatchKind.staff: 'STAFF',
  MediaBatchKind.vip: 'VIP',
};

const _$MediaBatchKeyModeEnumMap = {
  MediaBatchKeyMode.shared: 'SHARED',
  MediaBatchKeyMode.dedicated: 'DEDICATED',
};

const _$MediaBatchReusePolicyEnumMap = {
  MediaBatchReusePolicy.singleUse: 'SINGLE_USE',
  MediaBatchReusePolicy.personal: 'PERSONAL',
  MediaBatchReusePolicy.pool: 'POOL',
};

const _$MediaBatchStatusEnumMap = {
  MediaBatchStatus.ordered: 'ORDERED',
  MediaBatchStatus.personalized: 'PERSONALIZED',
  MediaBatchStatus.delivered: 'DELIVERED',
  MediaBatchStatus.active: 'ACTIVE',
  MediaBatchStatus.suspended: 'SUSPENDED',
  MediaBatchStatus.closed: 'CLOSED',
};

const _$MediaBatchDepositModeEnumMap = {
  MediaBatchDepositMode.fromBalance: 'FROM_BALANCE',
  MediaBatchDepositMode.separate: 'SEPARATE',
};
