// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'staff_user.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StaffUser _$StaffUserFromJson(Map<String, dynamic> json) => StaffUser(
  userId: json['user_id'] as String,
  operatorId: json['operator_id'] as String?,
  issuer: json['issuer'] as String,
  subject: json['subject'] as String,
  displayName: json['display_name'] as String,
  status: $enumDecode(_$StaffUserStatusEnumMap, json['status']),
  createdAt: DateTime.parse(json['created_at'] as String),
  disabledAt: json['disabled_at'] == null
      ? null
      : DateTime.parse(json['disabled_at'] as String),
  roleAssignments: (json['role_assignments'] as List<dynamic>)
      .map((e) => RoleAssignment.fromJson(e as Map<String, dynamic>))
      .toList(),
  email: json['email'] as String?,
  phone: json['phone'] as String?,
);

Map<String, dynamic> _$StaffUserToJson(StaffUser instance) => <String, dynamic>{
  'user_id': instance.userId,
  'operator_id': instance.operatorId,
  'issuer': instance.issuer,
  'subject': instance.subject,
  'email': instance.email,
  'phone': instance.phone,
  'display_name': instance.displayName,
  'status': instance.status,
  'created_at': instance.createdAt.toIso8601String(),
  'disabled_at': instance.disabledAt?.toIso8601String(),
  'role_assignments': instance.roleAssignments,
};

const _$StaffUserStatusEnumMap = {
  StaffUserStatus.active: 'ACTIVE',
  StaffUserStatus.disabled: 'DISABLED',
};
