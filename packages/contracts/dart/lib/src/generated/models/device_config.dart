// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog.dart';
import 'debit_authority.dart';
import 'device.dart';
import 'event.dart';
import 'offline_policy.dart';
import 'pos.dart';
import 'seq.dart';
import 'snapshot_keys.dart';
import 'terminal_settings.dart';
import 'timestamp.dart';

part 'device_config.g.dart';

@JsonSerializable()
class DeviceConfig {
  const DeviceConfig({
    required this.terminalSettings,
    required this.configId,
    required this.device,
    required this.event,
    required this.offlinePolicy,
    required this.snapshotKeys,
    required this.debitAuthority,
    required this.seq,
    required this.serverTime,
    this.clockToleranceSeconds = 120,
    this.pos,
    this.catalog,
  });

  factory DeviceConfig.fromJson(Map<String, Object?> json) =>
      _$DeviceConfigFromJson(json);

  /// Réglages de fonctionnement de l'événement (ADR-61, SPECIFICATION §9.8), bornés par la base.
  @JsonKey(name: 'terminal_settings')
  final TerminalSettings terminalSettings;

  /// Identifiant de la configuration servie (`device_config_served.id`), stable tant que la politique.
  /// effective, l'époque et le plancher de séquence ne changent pas. Le terminal le recopie dans chaque.
  /// opération qu'il autorise hors ligne (`OfflineOperation.config_id`, champ d'état non chaîné, comme.
  /// `snapshot_version`) : le serveur contrôle les plafonds de CETTE configuration (sync_protocol.md §7.2).
  ///
  @JsonKey(name: 'config_id')
  final int configId;
  final Device device;
  final Event event;
  final Pos? pos;

  /// Présent pour CATALOG_POS ; absent (null) pour KEYPAD_TPE / TOPUP_DESK.
  final Catalog? catalog;
  @JsonKey(name: 'offline_policy')
  final OfflinePolicy offlinePolicy;

  /// Clés publiques valides pour vérifier les snapshots (rotation par `key_id`), au plus deux par.
  /// signataire : le central (clé dans le KMS/HSM) et chaque passerelle (clé propre, hors KMS, dans son.
  /// stockage matériel, `key_id` distinct) — sync_protocol.md §4.1.
  ///
  @JsonKey(name: 'snapshot_keys')
  final List<SnapshotKeys> snapshotKeys;
  @JsonKey(name: 'debit_authority')
  final DebitAuthority debitAuthority;
  final Seq seq;
  @JsonKey(name: 'server_time')
  final Timestamp serverTime;
  @JsonKey(name: 'clock_tolerance_seconds')
  final int clockToleranceSeconds;

  Map<String, Object?> toJson() => _$DeviceConfigToJson(this);
}
