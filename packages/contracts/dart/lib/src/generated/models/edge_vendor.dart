// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_vendor_status.dart';

part 'edge_vendor.g.dart';

/// Vendeur. Usage : `createPayment` et `reversePayment` (vendeur `ACTIVE` et non bloqué, sinon.
/// `409 VENDOR_SESSION_INVALID`), attribution et `PaymentResult.vendor` (`display_name`). JAMAIS de PIN, ni.
/// d'empreinte de PIN (`pin_hash`), ni de compteur d'échecs, ni de secret de PIN : la passerelle n'ouvre.
/// aucune session vendeur, elle n'a donc rien à vérifier.
///
@JsonSerializable()
class EdgeVendor {
  const EdgeVendor({
    required this.vendorId,
    required this.displayName,
    required this.status,
    required this.locked,
  });

  factory EdgeVendor.fromJson(Map<String, Object?> json) =>
      _$EdgeVendorFromJson(json);

  @JsonKey(name: 'vendor_id')
  final String vendorId;
  @JsonKey(name: 'display_name')
  final String displayName;
  final EdgeVendorStatus status;

  /// Vrai si le vendeur est bloqué (`locked_at` non nul). Le compteur d'échecs n'est pas servi.
  final bool locked;

  Map<String, Object?> toJson() => _$EdgeVendorToJson(this);
}
