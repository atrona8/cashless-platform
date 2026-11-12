// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_unassigned_media.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeUnassignedMedia _$EdgeUnassignedMediaFromJson(Map<String, dynamic> json) =>
    EdgeUnassignedMedia(
      mediaId: json['media_id'] as String,
      nfcUid: json['nfc_uid'] as String,
      tokenHash: json['token_hash'] as String,
      keyIndex: (json['key_index'] as num).toInt(),
      originalitySigSha256: json['originality_sig_sha256'] as String?,
      status: $enumDecode(_$MediaStatusEnumMap, json['status']),
      batchEventId: json['batch_event_id'] as String?,
      batchStatus: $enumDecodeNullable(
        _$EdgeUnassignedMediaBatchStatusEnumMap,
        json['batch_status'],
      ),
      pwdPackEnc: json['pwd_pack_enc'] == null
          ? null
          : EncryptedBlob.fromJson(
              json['pwd_pack_enc'] as Map<String, dynamic>,
            ),
      pwdPackSha256: json['pwd_pack_sha256'] as String?,
    );

Map<String, dynamic> _$EdgeUnassignedMediaToJson(
  EdgeUnassignedMedia instance,
) => <String, dynamic>{
  'media_id': instance.mediaId,
  'nfc_uid': instance.nfcUid,
  'token_hash': instance.tokenHash,
  'key_index': instance.keyIndex,
  'originality_sig_sha256': instance.originalitySigSha256,
  'status': instance.status,
  'batch_event_id': instance.batchEventId,
  'batch_status': instance.batchStatus,
  'pwd_pack_enc': instance.pwdPackEnc,
  'pwd_pack_sha256': instance.pwdPackSha256,
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

const _$EdgeUnassignedMediaBatchStatusEnumMap = {
  EdgeUnassignedMediaBatchStatus.ordered: 'ORDERED',
  EdgeUnassignedMediaBatchStatus.personalized: 'PERSONALIZED',
  EdgeUnassignedMediaBatchStatus.delivered: 'DELIVERED',
  EdgeUnassignedMediaBatchStatus.active: 'ACTIVE',
  EdgeUnassignedMediaBatchStatus.suspended: 'SUSPENDED',
  EdgeUnassignedMediaBatchStatus.closed: 'CLOSED',
  EdgeUnassignedMediaBatchStatus.valueNull: null,
};
