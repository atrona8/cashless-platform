// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_batch_closure.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaBatchClosure _$MediaBatchClosureFromJson(Map<String, dynamic> json) =>
    MediaBatchClosure(
      status: $enumDecode(_$MediaBatchStatusEnumMap, json['status']),
      remainingDeposits: (json['remaining_deposits'] as num).toInt(),
      retiredMedia: (json['retired_media'] as num).toInt(),
      invalidatedClaimCodes: (json['invalidated_claim_codes'] as num).toInt(),
    );

Map<String, dynamic> _$MediaBatchClosureToJson(MediaBatchClosure instance) =>
    <String, dynamic>{
      'status': instance.status,
      'remaining_deposits': instance.remainingDeposits,
      'retired_media': instance.retiredMedia,
      'invalidated_claim_codes': instance.invalidatedClaimCodes,
    };

const _$MediaBatchStatusEnumMap = {
  MediaBatchStatus.ordered: 'ORDERED',
  MediaBatchStatus.personalized: 'PERSONALIZED',
  MediaBatchStatus.delivered: 'DELIVERED',
  MediaBatchStatus.active: 'ACTIVE',
  MediaBatchStatus.suspended: 'SUSPENDED',
  MediaBatchStatus.closed: 'CLOSED',
};
