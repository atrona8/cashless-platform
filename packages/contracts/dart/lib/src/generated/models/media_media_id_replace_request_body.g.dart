// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_media_id_replace_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaMediaIdReplaceRequestBody _$MediaMediaIdReplaceRequestBodyFromJson(
  Map<String, dynamic> json,
) => MediaMediaIdReplaceRequestBody(
  newMediaTap: TapInput.fromJson(json['new_media_tap'] as Map<String, dynamic>),
  reason: json['reason'] as String,
  newMediaTapId: (json['new_media_tap_id'] as num?)?.toInt(),
);

Map<String, dynamic> _$MediaMediaIdReplaceRequestBodyToJson(
  MediaMediaIdReplaceRequestBody instance,
) => <String, dynamic>{
  'new_media_tap': instance.newMediaTap,
  'new_media_tap_id': instance.newMediaTapId,
  'reason': instance.reason,
};
