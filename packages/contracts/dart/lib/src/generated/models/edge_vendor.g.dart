// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_vendor.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeVendor _$EdgeVendorFromJson(Map<String, dynamic> json) => EdgeVendor(
  vendorId: json['vendor_id'] as String,
  displayName: json['display_name'] as String,
  status: $enumDecode(_$EdgeVendorStatusEnumMap, json['status']),
  locked: json['locked'] as bool,
);

Map<String, dynamic> _$EdgeVendorToJson(EdgeVendor instance) =>
    <String, dynamic>{
      'vendor_id': instance.vendorId,
      'display_name': instance.displayName,
      'status': instance.status,
      'locked': instance.locked,
    };

const _$EdgeVendorStatusEnumMap = {
  EdgeVendorStatus.active: 'ACTIVE',
  EdgeVendorStatus.disabled: 'DISABLED',
};
