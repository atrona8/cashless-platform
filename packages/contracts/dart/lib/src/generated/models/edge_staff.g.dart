// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_staff.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeStaff _$EdgeStaffFromJson(Map<String, dynamic> json) => EdgeStaff(
  userId: json['user_id'] as String,
  issuer: json['issuer'] as String,
  subject: json['subject'] as String,
  status: json['status'] as String,
  roles: (json['roles'] as List<dynamic>)
      .map((e) => Roles.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$EdgeStaffToJson(EdgeStaff instance) => <String, dynamic>{
  'user_id': instance.userId,
  'issuer': instance.issuer,
  'subject': instance.subject,
  'status': instance.status,
  'roles': instance.roles,
};
