// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'vendor_status_change.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

VendorStatusChange _$VendorStatusChangeFromJson(Map<String, dynamic> json) =>
    VendorStatusChange(
      status: $enumDecode(_$VendorStatusEnumMap, json['status']),
    );

Map<String, dynamic> _$VendorStatusChangeToJson(VendorStatusChange instance) =>
    <String, dynamic>{'status': instance.status};

const _$VendorStatusEnumMap = {
  VendorStatus.active: 'ACTIVE',
  VendorStatus.disabled: 'DISABLED',
};
