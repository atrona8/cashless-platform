// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_item_admin.dart';

part 'catalog_item_result.g.dart';

/// Article écrit et numéro de la version du catalogue créée par l'écriture.
@JsonSerializable()
class CatalogItemResult {
  const CatalogItemResult({required this.item, required this.catalogVersion});

  factory CatalogItemResult.fromJson(Map<String, Object?> json) =>
      _$CatalogItemResultFromJson(json);

  final CatalogItemAdmin item;
  @JsonKey(name: 'catalog_version')
  final int catalogVersion;

  Map<String, Object?> toJson() => _$CatalogItemResultToJson(this);
}
