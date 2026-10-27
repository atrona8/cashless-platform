// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'catalog_label.dart';

part 'catalog_item_admin.g.dart';

/// Article du catalogue courant (back-office).
@JsonSerializable()
class CatalogItemAdmin {
  const CatalogItemAdmin({
    required this.itemId,
    required this.categoryId,
    required this.labelFr,
    required this.labelEn,
    required this.unitPrice,
    required this.vatRateBps,
    required this.active,
  });

  factory CatalogItemAdmin.fromJson(Map<String, Object?> json) =>
      _$CatalogItemAdminFromJson(json);

  @JsonKey(name: 'item_id')
  final String itemId;
  @JsonKey(name: 'category_id')
  final String categoryId;
  @JsonKey(name: 'label_fr')
  final CatalogLabel labelFr;
  @JsonKey(name: 'label_en')
  final CatalogLabel labelEn;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;
  @JsonKey(name: 'vat_rate_bps')
  final int vatRateBps;
  final bool active;

  Map<String, Object?> toJson() => _$CatalogItemAdminToJson(this);
}
