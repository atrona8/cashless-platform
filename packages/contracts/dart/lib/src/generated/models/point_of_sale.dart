// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'point_of_sale.g.dart';

/// Lieu d'encaissement d'une participation (`point_of_sale`), qui portera les terminaux.
@JsonSerializable()
class PointOfSale {
  const PointOfSale({
    required this.posId,
    required this.operatorId,
    required this.participationId,
    required this.name,
  });

  factory PointOfSale.fromJson(Map<String, Object?> json) =>
      _$PointOfSaleFromJson(json);

  @JsonKey(name: 'pos_id')
  final String posId;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'participation_id')
  final String participationId;
  final String name;

  Map<String, Object?> toJson() => _$PointOfSaleToJson(this);
}
