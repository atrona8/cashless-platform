// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_media_media_id_reassignment_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostMediaMediaIdReassignmentResponse
_$PostMediaMediaIdReassignmentResponseFromJson(Map<String, dynamic> json) =>
    PostMediaMediaIdReassignmentResponse(
      mediaId: json['media_id'] as String,
      mediaStatus: $enumDecode(_$MediaStatusEnumMap, json['media_status']),
    );

Map<String, dynamic> _$PostMediaMediaIdReassignmentResponseToJson(
  PostMediaMediaIdReassignmentResponse instance,
) => <String, dynamic>{
  'media_id': instance.mediaId,
  'media_status': instance.mediaStatus,
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
