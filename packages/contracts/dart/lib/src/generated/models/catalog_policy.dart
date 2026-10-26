// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'catalog_policy.g.dart';

/// Délégation de la gestion du catalogue d'un point de vente au commerçant (réglée par l'organisateur).
@JsonSerializable()
class CatalogPolicy {
  const CatalogPolicy({required this.merchantManages, this.posId});

  factory CatalogPolicy.fromJson(Map<String, Object?> json) =>
      _$CatalogPolicyFromJson(json);

  @JsonKey(name: 'pos_id')
  final String? posId;
  @JsonKey(name: 'merchant_manages')
  final bool merchantManages;

  Map<String, Object?> toJson() => _$CatalogPolicyToJson(this);
}
