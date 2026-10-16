// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_personalization.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaPersonalization _$MediaPersonalizationFromJson(
  Map<String, dynamic> json,
) => MediaPersonalization(
  mediaId: json['media_id'] as String,
  keyIndex: (json['key_index'] as num).toInt(),
  pwdPack: EncryptedBlob.fromJson(json['pwd_pack'] as Map<String, dynamic>),
);

Map<String, dynamic> _$MediaPersonalizationToJson(
  MediaPersonalization instance,
) => <String, dynamic>{
  'media_id': instance.mediaId,
  'key_index': instance.keyIndex,
  'pwd_pack': instance.pwdPack,
};
