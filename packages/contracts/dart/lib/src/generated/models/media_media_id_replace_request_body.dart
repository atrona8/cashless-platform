// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tap_input.dart';

part 'media_media_id_replace_request_body.g.dart';

@JsonSerializable()
class MediaMediaIdReplaceRequestBody {
  const MediaMediaIdReplaceRequestBody({
    required this.newMediaTap,
    required this.reason,
    this.newMediaTapId,
  });

  factory MediaMediaIdReplaceRequestBody.fromJson(Map<String, Object?> json) =>
      _$MediaMediaIdReplaceRequestBodyFromJson(json);

  @JsonKey(name: 'new_media_tap')
  final TapInput newMediaTap;

  /// Sans effet (voir `new_media_tap`) ; une demande qui ne porte que ce champ est refusée (`422`).
  @JsonKey(name: 'new_media_tap_id')
  final int? newMediaTapId;
  final String reason;

  Map<String, Object?> toJson() => _$MediaMediaIdReplaceRequestBodyToJson(this);
}
