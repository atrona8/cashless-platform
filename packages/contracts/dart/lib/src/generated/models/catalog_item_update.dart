// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'catalog_label.dart';

part 'catalog_item_update.g.dart';

@JsonSerializable()
class CatalogItemUpdate {
  const CatalogItemUpdate({
    this.categoryId,
    this.labelFr,
    this.labelEn,
    this.unitPrice,
    this.vatRateBps,
    this.active,
  });

  factory CatalogItemUpdate.fromJson(Map<String, Object?> json) =>
      _$CatalogItemUpdateFromJson(json);

  @JsonKey(name: 'category_id')
  final String? categoryId;
  @JsonKey(name: 'label_fr')
  final CatalogLabel? labelFr;
  @JsonKey(name: 'label_en')
  final CatalogLabel? labelEn;
  @JsonKey(name: 'unit_price')
  final Amount? unitPrice;
  @JsonKey(name: 'vat_rate_bps')
  final int? vatRateBps;
  final bool? active;

  Map<String, Object?> toJson() => _$CatalogItemUpdateToJson(this);
}
