// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'sale_line_result.g.dart';

/// Ligne enregistrée d'une vente : libellé (dans la langue de `Accept-Language`), prix et taux copiés de la.
/// version du catalogue retenue ; `line_total` = `quantity` × `unit_price`.
///
@JsonSerializable()
class SaleLineResult {
  const SaleLineResult({
    required this.productId,
    required this.label,
    required this.quantity,
    required this.unitPrice,
    required this.vatRateBps,
    required this.lineTotal,
    required this.catalogVersion,
  });

  factory SaleLineResult.fromJson(Map<String, Object?> json) =>
      _$SaleLineResultFromJson(json);

  @JsonKey(name: 'product_id')
  final String productId;
  final String label;
  final int quantity;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;
  @JsonKey(name: 'vat_rate_bps')
  final int vatRateBps;
  @JsonKey(name: 'line_total')
  final Amount lineTotal;
  @JsonKey(name: 'catalog_version')
  final int catalogVersion;

  Map<String, Object?> toJson() => _$SaleLineResultToJson(this);
}
