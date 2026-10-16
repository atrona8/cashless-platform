// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'role_scope_type.dart';
import 'staff_role.dart';
import 'timestamp.dart';

part 'role_assignment.g.dart';

@JsonSerializable()
class RoleAssignment {
  const RoleAssignment({
    required this.assignmentId,
    required this.role,
    required this.scopeType,
    required this.scopeId,
    required this.grantedBy,
    required this.grantedAt,
    required this.revokedAt,
  });

  factory RoleAssignment.fromJson(Map<String, Object?> json) =>
      _$RoleAssignmentFromJson(json);

  @JsonKey(name: 'assignment_id')
  final String assignmentId;
  final StaffRole role;
  @JsonKey(name: 'scope_type')
  final RoleScopeType scopeType;

  /// Objet de la portée ; `null` pour `PLATFORM`.
  @JsonKey(name: 'scope_id')
  final String? scopeId;

  /// Personne qui a attribué le rôle ; `null` pour l'amorçage.
  @JsonKey(name: 'granted_by')
  final String? grantedBy;
  @JsonKey(name: 'granted_at')
  final Timestamp grantedAt;
  @JsonKey(name: 'revoked_at')
  final DateTime? revokedAt;

  Map<String, Object?> toJson() => _$RoleAssignmentToJson(this);
}
