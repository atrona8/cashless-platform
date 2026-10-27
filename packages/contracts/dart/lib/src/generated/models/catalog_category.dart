// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_label.dart';

part 'catalog_category.g.dart';

@JsonSerializable()
class CatalogCategory {
  const CatalogCategory({
    required this.categoryId,
    required this.labelFr,
    required this.labelEn,
    required this.position,
    required this.active,
  });

  factory CatalogCategory.fromJson(Map<String, Object?> json) =>
      _$CatalogCategoryFromJson(json);

  @JsonKey(name: 'category_id')
  final String categoryId;
  @JsonKey(name: 'label_fr')
  final CatalogLabel labelFr;
  @JsonKey(name: 'label_en')
  final CatalogLabel labelEn;

  /// Ordre d'affichage (croissant).
  final int position;
  final bool active;

  Map<String, Object?> toJson() => _$CatalogCategoryToJson(this);
}
