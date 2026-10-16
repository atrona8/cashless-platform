// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_snapshot.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineSnapshot _$OfflineSnapshotFromJson(Map<String, dynamic> json) =>
    OfflineSnapshot(
      header: SnapshotHeader.fromJson(json['header'] as Map<String, dynamic>),
      signature: json['signature'] as String,
      entries: (json['entries'] as List<dynamic>)
          .map((e) => SnapshotEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      pwdPackKey: json['pwd_pack_key'] == null
          ? null
          : WrappedKey.fromJson(json['pwd_pack_key'] as Map<String, dynamic>),
      removedTokenHashes: (json['removed_token_hashes'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$OfflineSnapshotToJson(OfflineSnapshot instance) =>
    <String, dynamic>{
      'header': instance.header,
      'signature': instance.signature,
      'pwd_pack_key': instance.pwdPackKey,
      'entries': instance.entries,
      'removed_token_hashes': instance.removedTokenHashes,
    };
