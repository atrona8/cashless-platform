// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'vendor_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

VendorSession _$VendorSessionFromJson(Map<String, dynamic> json) =>
    VendorSession(
      vendorSessionId: json['vendor_session_id'] as String,
      vendorId: json['vendor_id'] as String,
      vendorDisplayName: json['vendor_display_name'] as String,
      expiresAt: DateTime.parse(json['expires_at'] as String),
    );

Map<String, dynamic> _$VendorSessionToJson(VendorSession instance) =>
    <String, dynamic>{
      'vendor_session_id': instance.vendorSessionId,
      'vendor_id': instance.vendorId,
      'vendor_display_name': instance.vendorDisplayName,
      'expires_at': instance.expiresAt.toIso8601String(),
    };
