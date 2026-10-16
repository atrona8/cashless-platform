// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'post_media_media_id_replace_response.g.dart';

@JsonSerializable()
class PostMediaMediaIdReplaceResponse {
  const PostMediaMediaIdReplaceResponse({
    required this.oldMediaId,
    required this.newMediaId,
    required this.walletId,
  });

  factory PostMediaMediaIdReplaceResponse.fromJson(Map<String, Object?> json) =>
      _$PostMediaMediaIdReplaceResponseFromJson(json);

  @JsonKey(name: 'old_media_id')
  final String oldMediaId;
  @JsonKey(name: 'new_media_id')
  final String newMediaId;
  @JsonKey(name: 'wallet_id')
  final String walletId;

  Map<String, Object?> toJson() =>
      _$PostMediaMediaIdReplaceResponseToJson(this);
}
