// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'staff_profile.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StaffProfile _$StaffProfileFromJson(Map<String, dynamic> json) => StaffProfile(
  userId: json['user_id'] as String,
  displayName: json['display_name'] as String,
  operatorId: json['operator_id'] as String?,
  assignments: (json['assignments'] as List<dynamic>)
      .map((e) => StaffAssignment.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$StaffProfileToJson(StaffProfile instance) =>
    <String, dynamic>{
      'user_id': instance.userId,
      'display_name': instance.displayName,
      'operator_id': instance.operatorId,
      'assignments': instance.assignments,
    };
