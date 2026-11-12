// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_vendor_session_closed_reason.dart';
import 'timestamp.dart';

part 'edge_vendor_session.g.dart';

/// Session vendeur ouverte au central. Usage : `assert_vendor_session` de `createPayment` et.
/// `reversePayment` (ouverte sur ce terminal, non expirée). La passerelle ne l'ouvre ni ne la prolonge.
/// (`expires_at` = `opened_at` + 12 h, contrainte `vendor_session_ttl`).
///
@JsonSerializable()
class EdgeVendorSession {
  const EdgeVendorSession({
    required this.vendorSessionId,
    required this.vendorId,
    required this.deviceId,
    required this.openedAt,
    required this.expiresAt,
    this.closedAt,
    this.closedReason,
  });

  factory EdgeVendorSession.fromJson(Map<String, Object?> json) =>
      _$EdgeVendorSessionFromJson(json);

  @JsonKey(name: 'vendor_session_id')
  final String vendorSessionId;
  @JsonKey(name: 'vendor_id')
  final String vendorId;
  @JsonKey(name: 'device_id')
  final String deviceId;
  @JsonKey(name: 'opened_at')
  final Timestamp openedAt;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;
  @JsonKey(name: 'closed_at')
  final Timestamp? closedAt;
  @JsonKey(name: 'closed_reason')
  final EdgeVendorSessionClosedReason? closedReason;

  Map<String, Object?> toJson() => _$EdgeVendorSessionToJson(this);
}
