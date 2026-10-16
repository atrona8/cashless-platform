// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hex32.dart';

part 'media_media_id_reassignment_request_body.g.dart';

@JsonSerializable()
class MediaMediaIdReassignmentRequestBody {
  const MediaMediaIdReassignmentRequestBody({required this.newTokenHash});

  factory MediaMediaIdReassignmentRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$MediaMediaIdReassignmentRequestBodyFromJson(json);

  @JsonKey(name: 'new_token_hash')
  final Hex32 newTokenHash;

  Map<String, Object?> toJson() =>
      _$MediaMediaIdReassignmentRequestBodyToJson(this);
}
