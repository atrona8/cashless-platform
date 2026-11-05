// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'offline_policy.g.dart';

/// Politique hors ligne EFFECTIVE (effective_offline_policy) ; 0 = interdit.
@JsonSerializable()
class OfflinePolicy {
  const OfflinePolicy({
    required this.offlineEnabled,
    required this.maxPerSale,
    required this.maxPerMediaPerDevice,
    required this.maxTotalPerDevice,
    required this.cashTopupOffline,
    required this.capped,
    this.maxSnapshotAgeSeconds = 900,
  });

  factory OfflinePolicy.fromJson(Map<String, Object?> json) =>
      _$OfflinePolicyFromJson(json);

  @JsonKey(name: 'offline_enabled')
  final bool offlineEnabled;
  @JsonKey(name: 'max_per_sale')
  final int maxPerSale;
  @JsonKey(name: 'max_per_media_per_device')
  final int maxPerMediaPerDevice;
  @JsonKey(name: 'max_total_per_device')
  final int maxTotalPerDevice;

  /// Âge maximal du snapshot pour autoriser hors ligne (paramètre `max_snapshot_age`, défaut 900 s =.
  /// 15 min). Au-delà, le terminal refuse toute nouvelle opération hors ligne (sync_protocol.md §4.3).
  ///
  @JsonKey(name: 'max_snapshot_age_seconds')
  final int maxSnapshotAgeSeconds;

  /// Toujours `false` : aucune recharge en espèces hors ligne (décision du porteur, R-02). Le type reste.
  /// `boolean` tant que `DeviceConfigService` (lot WP07) n'écrit pas le littéral `false` : un type littéral.
  /// casserait `typecheck` de l'API, hors de ce lot.
  ///
  @JsonKey(name: 'cash_topup_offline')
  final bool cashTopupOffline;

  /// Vrai si le plafond prestataire a réduit l'un des trois montants (`max_per_sale`,.
  /// `max_per_media_per_device`, `max_total_per_device`) ; ne concerne aucune autre valeur.
  ///
  final bool capped;

  Map<String, Object?> toJson() => _$OfflinePolicyToJson(this);
}
