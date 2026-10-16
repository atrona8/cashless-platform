// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'staff_user_create.g.dart';

/// Personne connue du serveur d'identité : `issuer` et `subject` sont les claims `iss` et `sub` de ses jetons.
/// `email` ou `phone` (E.164) obligatoire. Tout champ inconnu est ignoré.
///
@JsonSerializable()
class StaffUserCreate {
  const StaffUserCreate({
    required this.issuer,
    required this.subject,
    required this.displayName,
    this.email,
    this.phone,
  });

  factory StaffUserCreate.fromJson(Map<String, Object?> json) =>
      _$StaffUserCreateFromJson(json);

  final String issuer;
  final String subject;
  @JsonKey(name: 'display_name')
  final String displayName;
  final String? email;
  final String? phone;

  Map<String, Object?> toJson() => _$StaffUserCreateToJson(this);
}
