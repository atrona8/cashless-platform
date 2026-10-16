// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_media_media_id_replace_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostMediaMediaIdReplaceResponse _$PostMediaMediaIdReplaceResponseFromJson(
  Map<String, dynamic> json,
) => PostMediaMediaIdReplaceResponse(
  oldMediaId: json['old_media_id'] as String,
  newMediaId: json['new_media_id'] as String,
  walletId: json['wallet_id'] as String,
);

Map<String, dynamic> _$PostMediaMediaIdReplaceResponseToJson(
  PostMediaMediaIdReplaceResponse instance,
) => <String, dynamic>{
  'old_media_id': instance.oldMediaId,
  'new_media_id': instance.newMediaId,
  'wallet_id': instance.walletId,
};
