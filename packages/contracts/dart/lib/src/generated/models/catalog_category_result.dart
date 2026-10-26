// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_category.dart';

part 'catalog_category_result.g.dart';

/// Catégorie écrite et numéro de la version du catalogue créée par l'écriture.
@JsonSerializable()
class CatalogCategoryResult {
  const CatalogCategoryResult({
    required this.category,
    required this.catalogVersion,
  });

  factory CatalogCategoryResult.fromJson(Map<String, Object?> json) =>
      _$CatalogCategoryResultFromJson(json);

  final CatalogCategory category;
  @JsonKey(name: 'catalog_version')
  final int catalogVersion;

  Map<String, Object?> toJson() => _$CatalogCategoryResultToJson(this);
}
