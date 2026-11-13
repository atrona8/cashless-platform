// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_staff_token_audit_route.dart';
import 'timestamp.dart';

part 'edge_staff_token_audit.g.dart';

@JsonSerializable()
class EdgeStaffTokenAudit {
  const EdgeStaffTokenAudit({
    required this.edgeSeq,
    required this.at,
    required this.subject,
    required this.issuer,
    required this.jti,
    required this.secondsPastExpiry,
    required this.route,
    required this.deviceSerial,
    this.cashSessionId,
  });

  factory EdgeStaffTokenAudit.fromJson(Map<String, Object?> json) =>
      _$EdgeStaffTokenAuditFromJson(json);

  /// Opération de la file que ce jeton a autorisée.
  @JsonKey(name: 'edge_seq')
  final int edgeSeq;
  final Timestamp at;
  final String subject;
  final String issuer;
  final String jti;
  @JsonKey(name: 'seconds_past_expiry')
  final int secondsPastExpiry;
  final EdgeStaffTokenAuditRoute route;
  @JsonKey(name: 'device_serial')
  final String deviceSerial;
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$EdgeStaffTokenAuditToJson(this);
}
