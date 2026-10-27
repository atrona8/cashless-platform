// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'catalog_version_item.g.dart';

/// Article d'une version immuable du catalogue (copie à la création de la version).
@JsonSerializable()
class CatalogVersionItem {
  const CatalogVersionItem({
    required this.itemId,
    required this.categoryId,
    required this.labelFr,
    required this.labelEn,
    required this.unitPrice,
    required this.vatRateBps,
  });

  factory CatalogVersionItem.fromJson(Map<String, Object?> json) =>
      _$CatalogVersionItemFromJson(json);

  @JsonKey(name: 'item_id')
  final String itemId;
  @JsonKey(name: 'category_id')
  final String categoryId;
  @JsonKey(name: 'label_fr')
  final String labelFr;
  @JsonKey(name: 'label_en')
  final String labelEn;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;
  @JsonKey(name: 'vat_rate_bps')
  final int vatRateBps;

  Map<String, Object?> toJson() => _$CatalogVersionItemToJson(this);
}
