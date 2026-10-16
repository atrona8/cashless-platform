// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'role_scope_type.dart';
import 'staff_role.dart';

part 'role_grant.g.dart';

/// Un champ `approved_by` ou tout autre champ inconnu est ignoré.
@JsonSerializable()
class RoleGrant {
  const RoleGrant({required this.role, required this.scopeType, this.scopeId});

  factory RoleGrant.fromJson(Map<String, Object?> json) =>
      _$RoleGrantFromJson(json);

  final StaffRole role;
  @JsonKey(name: 'scope_type')
  final RoleScopeType scopeType;
  @JsonKey(name: 'scope_id')
  final String? scopeId;

  Map<String, Object?> toJson() => _$RoleGrantToJson(this);
}
