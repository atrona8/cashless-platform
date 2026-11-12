// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'items.g.dart';

@JsonSerializable()
class Items {
  const Items({
    required this.productId,
    required this.nameFr,
    required this.nameEn,
    required this.unitPrice,
    required this.vatRateBps,
    this.categoryFr,
    this.categoryEn,
  });

  factory Items.fromJson(Map<String, Object?> json) => _$ItemsFromJson(json);

  @JsonKey(name: 'product_id')
  final String productId;
  @JsonKey(name: 'name_fr')
  final String nameFr;
  @JsonKey(name: 'name_en')
  final String nameEn;
  @JsonKey(name: 'category_fr')
  final String? categoryFr;
  @JsonKey(name: 'category_en')
  final String? categoryEn;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;
  @JsonKey(name: 'vat_rate_bps')
  final int vatRateBps;

  Map<String, Object?> toJson() => _$ItemsToJson(this);
}
