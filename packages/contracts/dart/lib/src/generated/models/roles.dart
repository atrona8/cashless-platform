// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'role.dart';
import 'scope_type.dart';

part 'roles.g.dart';

@JsonSerializable()
class Roles {
  const Roles({
    required this.role,
    required this.scopeType,
    required this.scopeId,
  });

  factory Roles.fromJson(Map<String, Object?> json) => _$RolesFromJson(json);

  final Role role;
  @JsonKey(name: 'scope_type')
  final ScopeType scopeType;
  @JsonKey(name: 'scope_id')
  final String scopeId;

  Map<String, Object?> toJson() => _$RolesToJson(this);
}
