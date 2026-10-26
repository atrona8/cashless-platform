// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_version_item.dart';
import 'timestamp.dart';

part 'catalog_version.g.dart';

@JsonSerializable()
class CatalogVersion {
  const CatalogVersion({
    required this.posId,
    required this.version,
    required this.createdAt,
    required this.items,
  });

  factory CatalogVersion.fromJson(Map<String, Object?> json) =>
      _$CatalogVersionFromJson(json);

  @JsonKey(name: 'pos_id')
  final String posId;
  final int version;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  final List<CatalogVersionItem> items;

  Map<String, Object?> toJson() => _$CatalogVersionToJson(this);
}
