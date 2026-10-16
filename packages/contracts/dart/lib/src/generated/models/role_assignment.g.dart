// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'role_assignment.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RoleAssignment _$RoleAssignmentFromJson(Map<String, dynamic> json) =>
    RoleAssignment(
      assignmentId: json['assignment_id'] as String,
      role: $enumDecode(_$StaffRoleEnumMap, json['role']),
      scopeType: $enumDecode(_$RoleScopeTypeEnumMap, json['scope_type']),
      scopeId: json['scope_id'] as String?,
      grantedBy: json['granted_by'] as String?,
      grantedAt: DateTime.parse(json['granted_at'] as String),
      revokedAt: json['revoked_at'] == null
          ? null
          : DateTime.parse(json['revoked_at'] as String),
    );

Map<String, dynamic> _$RoleAssignmentToJson(RoleAssignment instance) =>
    <String, dynamic>{
      'assignment_id': instance.assignmentId,
      'role': instance.role,
      'scope_type': instance.scopeType,
      'scope_id': instance.scopeId,
      'granted_by': instance.grantedBy,
      'granted_at': instance.grantedAt.toIso8601String(),
      'revoked_at': instance.revokedAt?.toIso8601String(),
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
