// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'staff_assignment.dart';

part 'staff_profile.g.dart';

/// Profil de la personne du personnel authentifiée.
@JsonSerializable()
class StaffProfile {
  const StaffProfile({
    required this.userId,
    required this.displayName,
    required this.operatorId,
    required this.assignments,
  });

  factory StaffProfile.fromJson(Map<String, Object?> json) =>
      _$StaffProfileFromJson(json);

  @JsonKey(name: 'user_id')
  final String userId;
  @JsonKey(name: 'display_name')
  final String displayName;

  /// Prestataire de la personne (`null` pour la plateforme).
  @JsonKey(name: 'operator_id')
  final String? operatorId;
  final List<StaffAssignment> assignments;

  Map<String, Object?> toJson() => _$StaffProfileToJson(this);
}
