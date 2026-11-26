// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_status.dart';

part 'media2.g.dart';

@JsonSerializable()
class Media2 {
  const Media2({
    required this.mediaId,
    required this.status,
    required this.printedNumber,
  });

  factory Media2.fromJson(Map<String, Object?> json) => _$Media2FromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  final MediaStatus status;
  @JsonKey(name: 'printed_number')
  final String? printedNumber;

  Map<String, Object?> toJson() => _$Media2ToJson(this);
}
