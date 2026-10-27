// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_label.dart';

part 'catalog_category_create.g.dart';

@JsonSerializable()
class CatalogCategoryCreate {
  const CatalogCategoryCreate({
    required this.labelFr,
    required this.labelEn,
    this.position,
  });

  factory CatalogCategoryCreate.fromJson(Map<String, Object?> json) =>
      _$CatalogCategoryCreateFromJson(json);

  @JsonKey(name: 'label_fr')
  final CatalogLabel labelFr;
  @JsonKey(name: 'label_en')
  final CatalogLabel labelEn;

  /// Ordre d'affichage ; à défaut, après la dernière catégorie.
  final int? position;

  Map<String, Object?> toJson() => _$CatalogCategoryCreateToJson(this);
}
