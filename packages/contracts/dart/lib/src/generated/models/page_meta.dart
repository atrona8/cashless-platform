// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'page_meta.g.dart';

@JsonSerializable()
class PageMeta {
  const PageMeta({required this.nextCursor, required this.hasMore});

  factory PageMeta.fromJson(Map<String, Object?> json) =>
      _$PageMetaFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$PageMetaToJson(this);
}
