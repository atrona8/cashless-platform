// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key_request_scope.dart';

part 'tag_key_request.g.dart';

@JsonSerializable()
class TagKeyRequest {
  const TagKeyRequest({
    this.dedicatedEventId,
    this.scope = TagKeyRequestScope.shared,
  });

  factory TagKeyRequest.fromJson(Map<String, Object?> json) =>
      _$TagKeyRequestFromJson(json);

  final TagKeyRequestScope scope;

  /// Obligatoire pour `DEDICATED`, interdit sinon.
  @JsonKey(name: 'dedicated_event_id')
  final String? dedicatedEventId;

  Map<String, Object?> toJson() => _$TagKeyRequestToJson(this);
}
