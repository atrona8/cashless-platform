// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'catalog_label.dart';

part 'catalog_item_create.g.dart';

@JsonSerializable()
class CatalogItemCreate {
  const CatalogItemCreate({
    required this.labelFr,
    required this.labelEn,
    required this.unitPrice,
    required this.vatRateBps,
  });

  factory CatalogItemCreate.fromJson(Map<String, Object?> json) =>
      _$CatalogItemCreateFromJson(json);

  @JsonKey(name: 'label_fr')
  final CatalogLabel labelFr;
  @JsonKey(name: 'label_en')
  final CatalogLabel labelEn;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;
  @JsonKey(name: 'vat_rate_bps')
  final int vatRateBps;

  Map<String, Object?> toJson() => _$CatalogItemCreateToJson(this);
}
