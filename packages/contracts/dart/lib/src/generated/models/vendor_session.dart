// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'vendor_session.g.dart';

/// Session de vendeur ouverte sur ce terminal (identifiant non secret, 12 h au plus).
@JsonSerializable()
class VendorSession {
  const VendorSession({
    required this.vendorSessionId,
    required this.vendorId,
    required this.vendorDisplayName,
    required this.expiresAt,
  });

  factory VendorSession.fromJson(Map<String, Object?> json) =>
      _$VendorSessionFromJson(json);

  @JsonKey(name: 'vendor_session_id')
  final String vendorSessionId;
  @JsonKey(name: 'vendor_id')
  final String vendorId;
  @JsonKey(name: 'vendor_display_name')
  final String vendorDisplayName;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;

  Map<String, Object?> toJson() => _$VendorSessionToJson(this);
}
