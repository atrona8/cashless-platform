// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'classification.g.dart';

@JsonSerializable()
class Classification {
  const Classification({
    required this.reason,
    required this.classifiedBy,
    required this.classifiedAt,
  });

  factory Classification.fromJson(Map<String, Object?> json) =>
      _$ClassificationFromJson(json);

  final String reason;
  @JsonKey(name: 'classified_by')
  final String classifiedBy;
  @JsonKey(name: 'classified_at')
  final Timestamp classifiedAt;

  Map<String, Object?> toJson() => _$ClassificationToJson(this);
}
