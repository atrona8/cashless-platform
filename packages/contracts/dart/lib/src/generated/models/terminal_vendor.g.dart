// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'terminal_vendor.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TerminalVendor _$TerminalVendorFromJson(Map<String, dynamic> json) =>
    TerminalVendor(
      vendorId: json['vendor_id'] as String,
      displayName: json['display_name'] as String,
    );

Map<String, dynamic> _$TerminalVendorToJson(TerminalVendor instance) =>
    <String, dynamic>{
      'vendor_id': instance.vendorId,
      'display_name': instance.displayName,
    };
