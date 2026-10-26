// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'sale_vendor.g.dart';

/// Vendeur auquel le serveur a attribué la vente ou l'annulation (d'après la session de vendeur). Ni PIN, ni.
/// empreinte, ni compteur d'échecs. Absent pour une opération sans vendeur (recharge, remboursement).
///
@JsonSerializable()
class SaleVendor {
  const SaleVendor({required this.vendorId, required this.displayName});

  factory SaleVendor.fromJson(Map<String, Object?> json) =>
      _$SaleVendorFromJson(json);

  @JsonKey(name: 'vendor_id')
  final String vendorId;
  @JsonKey(name: 'display_name')
  final String displayName;

  Map<String, Object?> toJson() => _$SaleVendorToJson(this);
}
