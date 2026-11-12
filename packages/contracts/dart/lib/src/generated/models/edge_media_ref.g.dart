// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_media_ref.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeMediaRef _$EdgeMediaRefFromJson(Map<String, dynamic> json) => EdgeMediaRef(
  mediaId: json['media_id'] as String,
  tokenHash: json['token_hash'] as String,
  walletId: json['wallet_id'] as String?,
  status: $enumDecode(_$MediaStatusEnumMap, json['status']),
  batchStatus: $enumDecodeNullable(
    _$EdgeMediaRefBatchStatusEnumMap,
    json['batch_status'],
  ),
);

Map<String, dynamic> _$EdgeMediaRefToJson(EdgeMediaRef instance) =>
    <String, dynamic>{
      'media_id': instance.mediaId,
      'token_hash': instance.tokenHash,
      'wallet_id': instance.walletId,
      'status': instance.status,
      'batch_status': instance.batchStatus,
    };

const _$MediaStatusEnumMap = {
  MediaStatus.personalized: 'PERSONALIZED',
  MediaStatus.issued: 'ISSUED',
  MediaStatus.active: 'ACTIVE',
  MediaStatus.suspended: 'SUSPENDED',
  MediaStatus.replaced: 'REPLACED',
  MediaStatus.blacklisted: 'BLACKLISTED',
  MediaStatus.released: 'RELEASED',
  MediaStatus.retired: 'RETIRED',
  MediaStatus.destroyed: 'DESTROYED',
};

const _$EdgeMediaRefBatchStatusEnumMap = {
  EdgeMediaRefBatchStatus.ordered: 'ORDERED',
  EdgeMediaRefBatchStatus.personalized: 'PERSONALIZED',
  EdgeMediaRefBatchStatus.delivered: 'DELIVERED',
  EdgeMediaRefBatchStatus.active: 'ACTIVE',
  EdgeMediaRefBatchStatus.suspended: 'SUSPENDED',
  EdgeMediaRefBatchStatus.closed: 'CLOSED',
  EdgeMediaRefBatchStatus.valueNull: null,
};
