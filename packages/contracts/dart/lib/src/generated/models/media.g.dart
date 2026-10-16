// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Media _$MediaFromJson(Map<String, dynamic> json) => Media(
  mediaId: json['media_id'] as String,
  status: $enumDecode(_$MediaStatusEnumMap, json['status']),
  depositStatus: $enumDecode(_$DepositStatusEnumMap, json['deposit_status']),
  batchKind: $enumDecodeNullable(_$BatchKindEnumMap, json['batch_kind']),
  depositHeld: (json['deposit_held'] as num?)?.toInt(),
);

Map<String, dynamic> _$MediaToJson(Media instance) => <String, dynamic>{
  'media_id': instance.mediaId,
  'status': instance.status,
  'batch_kind': instance.batchKind,
  'deposit_status': instance.depositStatus,
  'deposit_held': instance.depositHeld,
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

const _$DepositStatusEnumMap = {
  DepositStatus.none: 'NONE',
  DepositStatus.due: 'DUE',
  DepositStatus.held: 'HELD',
  DepositStatus.refunded: 'REFUNDED',
  DepositStatus.forfeited: 'FORFEITED',
};

const _$BatchKindEnumMap = {
  BatchKind.public: 'PUBLIC',
  BatchKind.staff: 'STAFF',
  BatchKind.vip: 'VIP',
};
