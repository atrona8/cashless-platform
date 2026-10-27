// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'vendor.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Vendor _$VendorFromJson(Map<String, dynamic> json) => Vendor(
  vendorId: json['vendor_id'] as String,
  merchantId: json['merchant_id'] as String,
  displayName: json['display_name'] as String,
  status: $enumDecode(_$VendorStatusEnumMap, json['status']),
  locked: json['locked'] as bool,
);

Map<String, dynamic> _$VendorToJson(Vendor instance) => <String, dynamic>{
  'vendor_id': instance.vendorId,
  'merchant_id': instance.merchantId,
  'display_name': instance.displayName,
  'status': instance.status,
  'locked': instance.locked,
};

const _$VendorStatusEnumMap = {
  VendorStatus.active: 'ACTIVE',
  VendorStatus.disabled: 'DISABLED',
};
