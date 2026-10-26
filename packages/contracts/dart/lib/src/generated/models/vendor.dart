// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'vendor_status.dart';

part 'vendor.g.dart';

/// Vendeur d'un commerçant (lecture de la vue `vendor_public`). Ne contient jamais le PIN, son empreinte ni le.
/// compteur d'échecs : `locked` dit seulement si le vendeur est bloqué (5 PIN faux, levé par un nouveau PIN).
///
@JsonSerializable()
class Vendor {
  const Vendor({
    required this.vendorId,
    required this.merchantId,
    required this.displayName,
    required this.status,
    required this.locked,
  });

  factory Vendor.fromJson(Map<String, Object?> json) => _$VendorFromJson(json);

  @JsonKey(name: 'vendor_id')
  final String vendorId;
  @JsonKey(name: 'merchant_id')
  final String merchantId;
  @JsonKey(name: 'display_name')
  final String displayName;
  final VendorStatus status;
  final bool locked;

  Map<String, Object?> toJson() => _$VendorToJson(this);
}
