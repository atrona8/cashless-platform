// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'snapshot_entry.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SnapshotEntry _$SnapshotEntryFromJson(Map<String, dynamic> json) =>
    SnapshotEntry(
      originalitySigSha256: json['originality_sig_sha256'] as String?,
      tokenHash: json['token_hash'] as String,
      nfcUid: json['nfc_uid'] as String?,
      keyIndex: (json['key_index'] as num).toInt(),
      status: $enumDecode(_$MediaStatusEnumMap, json['status']),
      batchEventId: json['batch_event_id'] as String?,
      batchStatus: $enumDecodeNullable(
        _$SnapshotEntryBatchStatusEnumMap,
        json['batch_status'],
      ),
      walletStatus: $enumDecode(_$WalletStatusEnumMap, json['wallet_status']),
      spendable: (json['spendable'] as num).toInt(),
      lastCounter: (json['last_counter'] as num?)?.toInt(),
      pwdPackEnc: json['pwd_pack_enc'] == null
          ? null
          : EncryptedBlob.fromJson(
              json['pwd_pack_enc'] as Map<String, dynamic>,
            ),
    );

Map<String, dynamic> _$SnapshotEntryToJson(SnapshotEntry instance) =>
    <String, dynamic>{
      'originality_sig_sha256': instance.originalitySigSha256,
      'token_hash': instance.tokenHash,
      'nfc_uid': instance.nfcUid,
      'key_index': instance.keyIndex,
      'status': instance.status,
      'batch_event_id': instance.batchEventId,
      'batch_status': instance.batchStatus,
      'wallet_status': instance.walletStatus,
      'spendable': instance.spendable,
      'last_counter': instance.lastCounter,
      'pwd_pack_enc': instance.pwdPackEnc,
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

const _$SnapshotEntryBatchStatusEnumMap = {
  SnapshotEntryBatchStatus.ordered: 'ORDERED',
  SnapshotEntryBatchStatus.personalized: 'PERSONALIZED',
  SnapshotEntryBatchStatus.delivered: 'DELIVERED',
  SnapshotEntryBatchStatus.active: 'ACTIVE',
  SnapshotEntryBatchStatus.suspended: 'SUSPENDED',
  SnapshotEntryBatchStatus.closed: 'CLOSED',
  SnapshotEntryBatchStatus.valueNull: null,
};

const _$WalletStatusEnumMap = {
  WalletStatus.active: 'ACTIVE',
  WalletStatus.blocked: 'BLOCKED',
  WalletStatus.closed: 'CLOSED',
};
