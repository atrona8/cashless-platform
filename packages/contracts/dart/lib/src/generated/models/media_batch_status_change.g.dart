// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_batch_status_change.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaBatchStatusChange _$MediaBatchStatusChangeFromJson(
  Map<String, dynamic> json,
) => MediaBatchStatusChange(
  status: $enumDecode(_$MediaBatchStatusChangeStatusEnumMap, json['status']),
  reason: json['reason'] as String?,
);

Map<String, dynamic> _$MediaBatchStatusChangeToJson(
  MediaBatchStatusChange instance,
) => <String, dynamic>{'status': instance.status, 'reason': instance.reason};

const _$MediaBatchStatusChangeStatusEnumMap = {
  MediaBatchStatusChangeStatus.personalized: 'PERSONALIZED',
  MediaBatchStatusChangeStatus.delivered: 'DELIVERED',
  MediaBatchStatusChangeStatus.active: 'ACTIVE',
  MediaBatchStatusChangeStatus.suspended: 'SUSPENDED',
};
