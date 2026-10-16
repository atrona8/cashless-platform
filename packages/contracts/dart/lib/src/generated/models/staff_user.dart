// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'role_assignment.dart';
import 'staff_user_status.dart';
import 'timestamp.dart';

part 'staff_user.g.dart';

@JsonSerializable()
class StaffUser {
  const StaffUser({
    required this.userId,
    required this.operatorId,
    required this.issuer,
    required this.subject,
    required this.displayName,
    required this.status,
    required this.createdAt,
    required this.disabledAt,
    required this.roleAssignments,
    this.email,
    this.phone,
  });

  factory StaffUser.fromJson(Map<String, Object?> json) =>
      _$StaffUserFromJson(json);

  @JsonKey(name: 'user_id')
  final String userId;

  /// Prestataire ; `null` pour une personne de la plateforme.
  @JsonKey(name: 'operator_id')
  final String? operatorId;
  final String issuer;
  final String subject;
  final String? email;
  final String? phone;
  @JsonKey(name: 'display_name')
  final String displayName;
  final StaffUserStatus status;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'disabled_at')
  final DateTime? disabledAt;

  /// Attributions actives.
  @JsonKey(name: 'role_assignments')
  final List<RoleAssignment> roleAssignments;

  Map<String, Object?> toJson() => _$StaffUserToJson(this);
}
