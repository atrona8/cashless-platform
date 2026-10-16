// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_status.dart';

part 'post_media_media_id_reassignment_response.g.dart';

@JsonSerializable()
class PostMediaMediaIdReassignmentResponse {
  const PostMediaMediaIdReassignmentResponse({
    required this.mediaId,
    required this.mediaStatus,
  });

  factory PostMediaMediaIdReassignmentResponse.fromJson(
    Map<String, Object?> json,
  ) => _$PostMediaMediaIdReassignmentResponseFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'media_status')
  final MediaStatus mediaStatus;

  Map<String, Object?> toJson() =>
      _$PostMediaMediaIdReassignmentResponseToJson(this);
}
