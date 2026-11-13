// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'items.dart';

part 'edge_catalog.g.dart';

/// Catalogue d'un point de vente de l'événement. Usage : `createPayment` depuis une caisse `CATALOG_POS`.
/// (lignes obligatoires, prix et taux, sinon `422 SALE_LINES_INVALID`), bloc `catalog` de `getDeviceConfig`.
/// Les libellés sont servis dans les deux langues du catalogue : la passerelle choisit selon.
/// `Accept-Language`, comme le central.
///
@JsonSerializable()
class EdgeCatalog {
  const EdgeCatalog({
    required this.posId,
    required this.version,
    required this.items,
  });

  factory EdgeCatalog.fromJson(Map<String, Object?> json) =>
      _$EdgeCatalogFromJson(json);

  @JsonKey(name: 'pos_id')
  final String posId;
  final int version;
  final List<Items> items;

  Map<String, Object?> toJson() => _$EdgeCatalogToJson(this);
}
