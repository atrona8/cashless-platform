// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'roles.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Roles _$RolesFromJson(Map<String, dynamic> json) => Roles(
  role: $enumDecode(_$RoleEnumMap, json['role']),
  scopeType: $enumDecode(_$ScopeTypeEnumMap, json['scope_type']),
  scopeId: json['scope_id'] as String,
);

Map<String, dynamic> _$RolesToJson(Roles instance) => <String, dynamic>{
  'role': instance.role,
  'scope_type': instance.scopeType,
  'scope_id': instance.scopeId,
};

const _$RoleEnumMap = {Role.cashier: 'CASHIER', Role.supervisor: 'SUPERVISOR'};

const _$ScopeTypeEnumMap = {
  ScopeType.organizer: 'ORGANIZER',
  ScopeType.event: 'EVENT',
};
