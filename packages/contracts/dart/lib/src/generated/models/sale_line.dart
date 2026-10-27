// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'sale_line.g.dart';

/// Ligne d'une vente envoyée par le terminal. Depuis une caisse `CATALOG_POS`, `product_id` est requis (article.
/// du catalogue servi) ; prix et taux sont contrôlés contre la version courante ou la dernière version servie à.
/// ce terminal (`422 SALE_LINES_INVALID`). Libellé, prix et taux enregistrés sont ceux du catalogue, jamais.
/// ceux du corps. `label` est réservé aux relevés : il n'est pas lu pour une vente au catalogue.
///
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

  /// Article du catalogue (`CatalogItem.product_id`) ; requis depuis une caisse `CATALOG_POS`.
  @JsonKey(name: 'product_id')
  final String? productId;

  /// Réservé aux relevés ; ignoré pour une vente au catalogue.
  final String? label;
  final int quantity;
  @JsonKey(name: 'unit_price')
  final Amount unitPrice;

  Map<String, Object?> toJson() => _$SaleLineToJson(this);
}
