// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'roles.dart';

part 'edge_staff.g.dart';

/// Personne habilitée au guichet ou à l'approbation de terrain, avec ses seuls rôles `CASHIER` et.
/// `SUPERVISOR`. Usage : `X-Staff-Authorization` de `createCashTopup`, `activateMedia`, `takeDeposit` (le.
/// jeton prouve l'identité `issuer` + `subject` ; le prestataire, le statut et les rôles sont relus ici,.
/// comme `tx.identify` au central) ; `reversePayment` sur approbation d'un `SUPERVISOR` ; condition 2 de la.
/// tolérance du jeton expiré (même personne que `EdgeCashSession.opened_by`). Aucune coordonnée (courriel,.
/// téléphone) ni nom : le minimum pour identifier et autoriser. Un autre rôle (`OPERATOR_ADMIN`...) n'est.
/// pas servi.
///
@JsonSerializable()
class EdgeStaff {
  const EdgeStaff({
    required this.userId,
    required this.issuer,
    required this.subject,
    required this.status,
    required this.roles,
  });

  factory EdgeStaff.fromJson(Map<String, Object?> json) =>
      _$EdgeStaffFromJson(json);

  @JsonKey(name: 'user_id')
  final String userId;
  final String issuer;
  final String subject;

  /// État de la personne (`app_user.status`) ; tout état autre qu'`ACTIVE` refuse l'accès.
  final String status;

  /// Affectations non révoquées de `CASHIER` ou `SUPERVISOR`. Vide : la personne perd l'accès.
  final List<Roles> roles;

  Map<String, Object?> toJson() => _$EdgeStaffToJson(this);
}
