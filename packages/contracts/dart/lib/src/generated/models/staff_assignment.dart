// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'staff_assignment_role.dart';
import 'staff_assignment_scope_type.dart';

part 'staff_assignment.g.dart';

/// Attribution d'un rôle du personnel sur une portée.
@JsonSerializable()
class StaffAssignment {
  const StaffAssignment({
    required this.role,
    required this.scopeType,
    required this.scopeId,
  });

  factory StaffAssignment.fromJson(Map<String, Object?> json) =>
      _$StaffAssignmentFromJson(json);

  final StaffAssignmentRole role;
  @JsonKey(name: 'scope_type')
  final StaffAssignmentScopeType scopeType;

  /// Identifiant de la portée (`null` pour `PLATFORM`).
  @JsonKey(name: 'scope_id')
  final String? scopeId;

  Map<String, Object?> toJson() => _$StaffAssignmentToJson(this);
}
