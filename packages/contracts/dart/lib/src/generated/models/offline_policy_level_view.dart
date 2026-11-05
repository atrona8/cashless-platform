// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_policy.dart';
import 'offline_policy_level.dart';
import 'offline_policy_level_view_level.dart';
import 'offline_risk.dart';

part 'offline_policy_level_view.g.dart';

@JsonSerializable()
class OfflinePolicyLevelView {
  const OfflinePolicyLevelView({
    required this.level,
    required this.scopeId,
    required this.policy,
    required this.version,
    required this.updatedAt,
    required this.updatedBy,
    this.effective,
    this.risk,
  });

  factory OfflinePolicyLevelView.fromJson(Map<String, Object?> json) =>
      _$OfflinePolicyLevelViewFromJson(json);

  final OfflinePolicyLevelViewLevel level;

  /// Prestataire, organisateur, événement ou terminal (le prestataire pour `OPERATOR_CEILING`).
  @JsonKey(name: 'scope_id')
  final String scopeId;
  final OfflinePolicyLevel policy;

  /// Version du niveau ; 0 pour un niveau jamais posé (ou effacé).
  final int version;
  @JsonKey(name: 'updated_at')
  final DateTime? updatedAt;

  /// Personne auteur de la dernière modification.
  @JsonKey(name: 'updated_by')
  final String? updatedBy;

  /// Présent pour un terminal : politique effective, plafond prestataire appliqué.
  final OfflinePolicy? effective;

  /// Présent pour un événement : exposition maximale hors ligne.
  final OfflineRisk? risk;

  Map<String, Object?> toJson() => _$OfflinePolicyLevelViewToJson(this);
}
