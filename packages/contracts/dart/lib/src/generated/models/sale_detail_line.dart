// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'sale_detail_line.g.dart';

/// Ligne d'une vente. Montants en unités mineures.
@JsonSerializable()
class SaleDetailLine {
  const SaleDetailLine({
    required this.lineNo,
    required this.itemId,
    required this.labelFr,
    required this.labelEn,
    required this.quantity,
    required this.unitPrice,
    required this.vatRateBps,
    required this.lineTotal,
  });

  factory SaleDetailLine.fromJson(Map<String, Object?> json) =>
      _$SaleDetailLineFromJson(json);

  @JsonKey(name: 'line_no')
  final int lineNo;
  @JsonKey(name: 'item_id')
  final String? itemId;
  @JsonKey(name: 'label_fr')
  final String labelFr;
  @JsonKey(name: 'label_en')
  final String labelEn;
  final int quantity;
  @JsonKey(name: 'unit_price')
  final int unitPrice;

  /// Taux de TVA en points de base.
  @JsonKey(name: 'vat_rate_bps')
  final int vatRateBps;
  @JsonKey(name: 'line_total')
  final int lineTotal;

  Map<String, Object?> toJson() => _$SaleDetailLineToJson(this);
}
