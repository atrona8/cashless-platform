// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_admin.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaAdmin _$MediaAdminFromJson(Map<String, dynamic> json) => MediaAdmin(
  mediaId: json['media_id'] as String,
  status: $enumDecode(_$MediaStatusEnumMap, json['status']),
  kind: $enumDecode(_$MediaAdminKindEnumMap, json['kind']),
  keyIndex: (json['key_index'] as num).toInt(),
  depositStatus: $enumDecode(_$DepositStatusEnumMap, json['deposit_status']),
  depositHeld: (json['deposit_held'] as num).toInt(),
  hasClaimCode: json['has_claim_code'] as bool,
  wallets: (json['wallets'] as List<dynamic>)
      .map((e) => Wallets2.fromJson(e as Map<String, dynamic>))
      .toList(),
  personalizedAt: json['personalized_at'] == null
      ? null
      : DateTime.parse(json['personalized_at'] as String),
  batchId: json['batch_id'] as String?,
  batchKind: $enumDecodeNullable(
    _$MediaAdminBatchKindEnumMap,
    json['batch_kind'],
  ),
  batchStatus: $enumDecodeNullable(
    _$MediaBatchStatusEnumMap,
    json['batch_status'],
  ),
  organizerId: json['organizer_id'] as String?,
  eventId: json['event_id'] as String?,
  claimCodeUsedAt: json['claim_code_used_at'] == null
      ? null
      : DateTime.parse(json['claim_code_used_at'] as String),
);

Map<String, dynamic> _$MediaAdminToJson(MediaAdmin instance) =>
    <String, dynamic>{
      'media_id': instance.mediaId,
      'status': instance.status,
      'kind': instance.kind,
      'key_index': instance.keyIndex,
      'personalized_at': instance.personalizedAt?.toIso8601String(),
      'batch_id': instance.batchId,
      'batch_kind': instance.batchKind,
      'batch_status': instance.batchStatus,
      'organizer_id': instance.organizerId,
      'event_id': instance.eventId,
      'deposit_status': instance.depositStatus,
      'deposit_held': instance.depositHeld,
      'has_claim_code': instance.hasClaimCode,
      'claim_code_used_at': instance.claimCodeUsedAt?.toIso8601String(),
      'wallets': instance.wallets,
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

const _$MediaAdminKindEnumMap = {
  MediaAdminKind.nfcTag: 'NFC_TAG',
  MediaAdminKind.card: 'CARD',
  MediaAdminKind.qr: 'QR',
};

const _$DepositStatusEnumMap = {
  DepositStatus.none: 'NONE',
  DepositStatus.due: 'DUE',
  DepositStatus.held: 'HELD',
  DepositStatus.refunded: 'REFUNDED',
  DepositStatus.forfeited: 'FORFEITED',
};

const _$MediaAdminBatchKindEnumMap = {
  MediaAdminBatchKind.public: 'PUBLIC',
  MediaAdminBatchKind.staff: 'STAFF',
  MediaAdminBatchKind.vip: 'VIP',
};

const _$MediaBatchStatusEnumMap = {
  MediaBatchStatus.ordered: 'ORDERED',
  MediaBatchStatus.personalized: 'PERSONALIZED',
  MediaBatchStatus.delivered: 'DELIVERED',
  MediaBatchStatus.active: 'ACTIVE',
  MediaBatchStatus.suspended: 'SUSPENDED',
  MediaBatchStatus.closed: 'CLOSED',
};
