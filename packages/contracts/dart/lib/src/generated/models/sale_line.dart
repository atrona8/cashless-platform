// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'sale_line.g.dart';

@JsonSerializable()
class SaleLine {
  const SaleLine({
    required this.quantity,
    required this.unitPrice,
    this.productId,
    this.label,
  });

  factory SaleLine.fromJson(Map<String, Object?> json) =>
      _$SaleLineFromJson(json);

  @JsonKey(name: 'product_id')
  final String? productId;
  final String? label;
  final int quantity;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;

  Map<String, Object?> toJson() => _$SaleLineToJson(this);
}
