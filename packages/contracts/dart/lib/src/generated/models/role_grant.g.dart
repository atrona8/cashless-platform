// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'role_grant.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RoleGrant _$RoleGrantFromJson(Map<String, dynamic> json) => RoleGrant(
  role: $enumDecode(_$StaffRoleEnumMap, json['role']),
  scopeType: $enumDecode(_$RoleScopeTypeEnumMap, json['scope_type']),
  scopeId: json['scope_id'] as String?,
);

Map<String, dynamic> _$RoleGrantToJson(RoleGrant instance) => <String, dynamic>{
  'role': instance.role,
  'scope_type': instance.scopeType,
  'scope_id': instance.scopeId,
};

const _$StaffRoleEnumMap = {
  StaffRole.platformAdmin: 'PLATFORM_ADMIN',
  StaffRole.operatorAdmin: 'OPERATOR_ADMIN',
  StaffRole.organizerAdmin: 'ORGANIZER_ADMIN',
  StaffRole.supervisor: 'SUPERVISOR',
  StaffRole.cashier: 'CASHIER',
  StaffRole.merchantAdmin: 'MERCHANT_ADMIN',
  StaffRole.vendor: 'VENDOR',
  StaffRole.customer: 'CUSTOMER',
  StaffRole.personalizer: 'PERSONALIZER',
};

const _$RoleScopeTypeEnumMap = {
  RoleScopeType.platform: 'PLATFORM',
  RoleScopeType.valueOperator: 'OPERATOR',
  RoleScopeType.organizer: 'ORGANIZER',
  RoleScopeType.event: 'EVENT',
  RoleScopeType.merchant: 'MERCHANT',
};
