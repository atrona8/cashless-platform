// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'catalog_item.g.dart';

@JsonSerializable()
class CatalogItem {
  const CatalogItem({
    required this.productId,
    required this.name,
    required this.unitPrice,
    this.category,
    this.vatRateBps,
  });

  factory CatalogItem.fromJson(Map<String, Object?> json) =>
      _$CatalogItemFromJson(json);

  @JsonKey(name: 'product_id')
  final String productId;
  final String name;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;
  final String? category;
  @JsonKey(name: 'vat_rate_bps')
  final int? vatRateBps;

  Map<String, Object?> toJson() => _$CatalogItemToJson(this);
}
