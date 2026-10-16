// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_auth_key_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaAuthKeyRequest _$MediaAuthKeyRequestFromJson(Map<String, dynamic> json) =>
    MediaAuthKeyRequest(
      nfcUid: json['nfc_uid'] as String,
      keyIndex: (json['key_index'] as num).toInt(),
    );

Map<String, dynamic> _$MediaAuthKeyRequestToJson(
  MediaAuthKeyRequest instance,
) => <String, dynamic>{
  'nfc_uid': instance.nfcUid,
  'key_index': instance.keyIndex,
};
