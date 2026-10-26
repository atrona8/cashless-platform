// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'terminal_vendor.g.dart';

/// Vendeur proposé à l'écran de connexion du terminal ; rien d'autre que l'identifiant et le nom.
@JsonSerializable()
class TerminalVendor {
  const TerminalVendor({required this.vendorId, required this.displayName});

  factory TerminalVendor.fromJson(Map<String, Object?> json) =>
      _$TerminalVendorFromJson(json);

  @JsonKey(name: 'vendor_id')
  final String vendorId;
  @JsonKey(name: 'display_name')
  final String displayName;

  Map<String, Object?> toJson() => _$TerminalVendorToJson(this);
}
