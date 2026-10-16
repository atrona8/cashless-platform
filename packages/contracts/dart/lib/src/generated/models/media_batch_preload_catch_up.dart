// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'media_batch_preload_catch_up.g.dart';

@JsonSerializable()
class MediaBatchPreloadCatchUp {
  const MediaBatchPreloadCatchUp({required this.processed});

  factory MediaBatchPreloadCatchUp.fromJson(Map<String, Object?> json) =>
      _$MediaBatchPreloadCatchUpFromJson(json);

  /// Bracelets préchargés par cet appel ; 0 = plus rien à rattraper.
  final int processed;

  Map<String, Object?> toJson() => _$MediaBatchPreloadCatchUpToJson(this);
}
