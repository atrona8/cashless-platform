// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_vendor_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeVendorSession _$EdgeVendorSessionFromJson(Map<String, dynamic> json) =>
    EdgeVendorSession(
      vendorSessionId: json['vendor_session_id'] as String,
      vendorId: json['vendor_id'] as String,
      deviceId: json['device_id'] as String,
      openedAt: DateTime.parse(json['opened_at'] as String),
      expiresAt: DateTime.parse(json['expires_at'] as String),
      closedAt: json['closed_at'] == null
          ? null
          : DateTime.parse(json['closed_at'] as String),
      closedReason: $enumDecodeNullable(
        _$EdgeVendorSessionClosedReasonEnumMap,
        json['closed_reason'],
      ),
    );

Map<String, dynamic> _$EdgeVendorSessionToJson(EdgeVendorSession instance) =>
    <String, dynamic>{
      'vendor_session_id': instance.vendorSessionId,
      'vendor_id': instance.vendorId,
      'device_id': instance.deviceId,
      'opened_at': instance.openedAt.toIso8601String(),
      'expires_at': instance.expiresAt.toIso8601String(),
      'closed_at': instance.closedAt?.toIso8601String(),
      'closed_reason': instance.closedReason,
    };

const _$EdgeVendorSessionClosedReasonEnumMap = {
  EdgeVendorSessionClosedReason.logout: 'LOGOUT',
  EdgeVendorSessionClosedReason.replaced: 'REPLACED',
  EdgeVendorSessionClosedReason.vendorDisabled: 'VENDOR_DISABLED',
  EdgeVendorSessionClosedReason.vendorLocked: 'VENDOR_LOCKED',
  EdgeVendorSessionClosedReason.deviceSuspended: 'DEVICE_SUSPENDED',
  EdgeVendorSessionClosedReason.deviceRevoked: 'DEVICE_REVOKED',
  EdgeVendorSessionClosedReason.pinChanged: 'PIN_CHANGED',
};
