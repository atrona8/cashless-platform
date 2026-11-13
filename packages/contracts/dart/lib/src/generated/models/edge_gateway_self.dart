// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_gateway_self_role.dart';
import 'edge_gateway_self_status.dart';
import 'timestamp.dart';

part 'edge_gateway_self.g.dart';

/// Ligne de la passerelle appelante (jamais d'une autre). Porte son rôle : la promotion d'une `STANDBY` est.
/// un changement de rôle fait au central par la fonction atomique `swap_edge_gateway_roles` ; la passerelle.
/// l'apprend par ce bloc, relu à chaque passe (A25). Sûreté : elle ne débite jamais sans l'accusé `200`.
///
@JsonSerializable()
class EdgeGatewaySelf {
  const EdgeGatewaySelf({
    required this.gatewayId,
    required this.role,
    required this.status,
    this.roleChangedAt,
  });

  factory EdgeGatewaySelf.fromJson(Map<String, Object?> json) =>
      _$EdgeGatewaySelfFromJson(json);

  @JsonKey(name: 'gateway_id')
  final String gatewayId;
  final EdgeGatewaySelfRole role;
  final EdgeGatewaySelfStatus status;
  @JsonKey(name: 'role_changed_at')
  final Timestamp? roleChangedAt;

  Map<String, Object?> toJson() => _$EdgeGatewaySelfToJson(this);
}
