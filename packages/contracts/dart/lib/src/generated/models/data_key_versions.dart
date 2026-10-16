// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key_status.dart';
import 'timestamp.dart';

part 'data_key_versions.g.dart';

@JsonSerializable()
class DataKeyVersions {
  const DataKeyVersions({
    required this.version,
    required this.status,
    required this.createdAt,
  });

  factory DataKeyVersions.fromJson(Map<String, Object?> json) =>
      _$DataKeyVersionsFromJson(json);

  final int version;
  final TagKeyStatus status;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;

  Map<String, Object?> toJson() => _$DataKeyVersionsToJson(this);
}
