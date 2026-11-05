// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'offline_policy_level_update.g.dart';

/// Corps de `PUT` d'un niveau : les valeurs du niveau plus la version attendue. Un corps sans aucune valeur.
/// (seulement `version`) efface le niveau.
///
@JsonSerializable()
class OfflinePolicyLevelUpdate {
  const OfflinePolicyLevelUpdate({
    this.offlineEnabled,
    this.maxPerSale,
    this.maxPerMediaPerDevice,
    this.maxTotalPerDevice,
    this.maxSnapshotAgeSeconds,
    this.cashTopupOffline,
    this.version,
  });

  factory OfflinePolicyLevelUpdate.fromJson(Map<String, Object?> json) =>
      _$OfflinePolicyLevelUpdateFromJson(json);

  @JsonKey(name: 'offline_enabled')
  final bool? offlineEnabled;
  @JsonKey(name: 'max_per_sale')
  final int? maxPerSale;
  @JsonKey(name: 'max_per_media_per_device')
  final int? maxPerMediaPerDevice;
  @JsonKey(name: 'max_total_per_device')
  final int? maxTotalPerDevice;

  /// Âge maximal du snapshot, de 0 à 24 h.
  @JsonKey(name: 'max_snapshot_age_seconds')
  final int? maxSnapshotAgeSeconds;

  /// Ne vaut jamais `true` : le schéma refuse `true` (`422 VALIDATION_FAILED`). Aucune recharge en espèces.
  /// hors ligne (décision du porteur, R-02). Absente = hérite (donc `false`) ; jamais `null`.
  ///
  @JsonKey(name: 'cash_topup_offline')
  final bool? cashTopupOffline;

  /// Version du niveau lue avant la modification. Absente ou nulle pour créer un niveau qui n'existe pas.
  /// encore ; sinon doit égaler la version courante (`409 CONFLICT_STATE`, `CL046`).
  ///
  final int? version;

  Map<String, Object?> toJson() => _$OfflinePolicyLevelUpdateToJson(this);
}
