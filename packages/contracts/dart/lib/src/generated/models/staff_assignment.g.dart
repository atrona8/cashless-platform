// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'staff_assignment.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StaffAssignment _$StaffAssignmentFromJson(Map<String, dynamic> json) =>
    StaffAssignment(
      role: $enumDecode(_$StaffAssignmentRoleEnumMap, json['role']),
      scopeType: $enumDecode(
        _$StaffAssignmentScopeTypeEnumMap,
        json['scope_type'],
      ),
      scopeId: json['scope_id'] as String?,
    );

Map<String, dynamic> _$StaffAssignmentToJson(StaffAssignment instance) =>
    <String, dynamic>{
      'role': instance.role,
      'scope_type': instance.scopeType,
      'scope_id': instance.scopeId,
    };

const _$StaffAssignmentRoleEnumMap = {
  StaffAssignmentRole.platformAdmin: 'PLATFORM_ADMIN',
  StaffAssignmentRole.operatorAdmin: 'OPERATOR_ADMIN',
  StaffAssignmentRole.organizerAdmin: 'ORGANIZER_ADMIN',
  StaffAssignmentRole.merchantAdmin: 'MERCHANT_ADMIN',
  StaffAssignmentRole.supervisor: 'SUPERVISOR',
  StaffAssignmentRole.cashier: 'CASHIER',
  StaffAssignmentRole.personalizer: 'PERSONALIZER',
};

const _$StaffAssignmentScopeTypeEnumMap = {
  StaffAssignmentScopeType.platform: 'PLATFORM',
  StaffAssignmentScopeType.valueOperator: 'OPERATOR',
  StaffAssignmentScopeType.organizer: 'ORGANIZER',
  StaffAssignmentScopeType.event: 'EVENT',
  StaffAssignmentScopeType.merchant: 'MERCHANT',
};
