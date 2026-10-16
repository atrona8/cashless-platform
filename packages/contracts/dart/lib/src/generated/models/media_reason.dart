// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'media_reason.g.dart';

@JsonSerializable()
class MediaReason {
  const MediaReason({required this.reason});

  factory MediaReason.fromJson(Map<String, Object?> json) =>
      _$MediaReasonFromJson(json);

  final String reason;

  Map<String, Object?> toJson() => _$MediaReasonToJson(this);
}
