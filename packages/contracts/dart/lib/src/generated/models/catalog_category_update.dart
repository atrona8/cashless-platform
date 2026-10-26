// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_label.dart';

part 'catalog_category_update.g.dart';

@JsonSerializable()
class CatalogCategoryUpdate {
  const CatalogCategoryUpdate({
    this.labelFr,
    this.labelEn,
    this.position,
    this.active,
  });

  factory CatalogCategoryUpdate.fromJson(Map<String, Object?> json) =>
      _$CatalogCategoryUpdateFromJson(json);

  @JsonKey(name: 'label_fr')
  final CatalogLabel? labelFr;
  @JsonKey(name: 'label_en')
  final CatalogLabel? labelEn;
  final int? position;
  final bool? active;

  Map<String, Object?> toJson() => _$CatalogCategoryUpdateToJson(this);
}
