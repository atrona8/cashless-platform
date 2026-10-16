// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'staff_user_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StaffUserCreate _$StaffUserCreateFromJson(Map<String, dynamic> json) =>
    StaffUserCreate(
      issuer: json['issuer'] as String,
      subject: json['subject'] as String,
      displayName: json['display_name'] as String,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
    );

Map<String, dynamic> _$StaffUserCreateToJson(StaffUserCreate instance) =>
    <String, dynamic>{
      'issuer': instance.issuer,
      'subject': instance.subject,
      'display_name': instance.displayName,
      'email': instance.email,
      'phone': instance.phone,
    };
