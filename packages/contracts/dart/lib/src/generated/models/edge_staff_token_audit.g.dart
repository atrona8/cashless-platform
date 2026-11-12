// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_staff_token_audit.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeStaffTokenAudit _$EdgeStaffTokenAuditFromJson(Map<String, dynamic> json) =>
    EdgeStaffTokenAudit(
      edgeSeq: (json['edge_seq'] as num).toInt(),
      at: DateTime.parse(json['at'] as String),
      subject: json['subject'] as String,
      issuer: json['issuer'] as String,
      jti: json['jti'] as String,
      secondsPastExpiry: (json['seconds_past_expiry'] as num).toInt(),
      route: $enumDecode(_$EdgeStaffTokenAuditRouteEnumMap, json['route']),
      deviceSerial: json['device_serial'] as String,
      cashSessionId: json['cash_session_id'] as String?,
    );

Map<String, dynamic> _$EdgeStaffTokenAuditToJson(
  EdgeStaffTokenAudit instance,
) => <String, dynamic>{
  'edge_seq': instance.edgeSeq,
  'at': instance.at.toIso8601String(),
  'subject': instance.subject,
  'issuer': instance.issuer,
  'jti': instance.jti,
  'seconds_past_expiry': instance.secondsPastExpiry,
  'route': instance.route,
  'device_serial': instance.deviceSerial,
  'cash_session_id': instance.cashSessionId,
};

const _$EdgeStaffTokenAuditRouteEnumMap = {
  EdgeStaffTokenAuditRoute.activateMedia: 'activateMedia',
  EdgeStaffTokenAuditRoute.takeDeposit: 'takeDeposit',
  EdgeStaffTokenAuditRoute.createCashTopup: 'createCashTopup',
};
