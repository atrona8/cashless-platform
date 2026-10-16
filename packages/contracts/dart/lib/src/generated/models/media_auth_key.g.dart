// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_auth_key.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaAuthKey _$MediaAuthKeyFromJson(Map<String, dynamic> json) => MediaAuthKey(
  nfcUid: json['nfc_uid'] as String,
  keyIndex: (json['key_index'] as num).toInt(),
  enc: EncryptedBlob.fromJson(json['enc'] as Map<String, dynamic>),
  ttlSeconds: (json['ttl_seconds'] as num).toInt(),
);

Map<String, dynamic> _$MediaAuthKeyToJson(MediaAuthKey instance) =>
    <String, dynamic>{
      'nfc_uid': instance.nfcUid,
      'key_index': instance.keyIndex,
      'enc': instance.enc,
      'ttl_seconds': instance.ttlSeconds,
    };
