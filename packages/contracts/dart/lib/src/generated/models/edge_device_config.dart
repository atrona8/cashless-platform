// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_policy.dart';

part 'edge_device_config.g.dart';

/// Configuration effective servie par le central à un terminal, et celles encore en vigueur. Usage :.
/// `getDeviceConfig` et `postDeviceHeartbeat` doivent rendre le `config_id` du central (il ne se recrée.
/// pas sur la passerelle) ; `submitOfflineBatch` contrôle les plafonds de la configuration citée par.
/// `OfflineOperation.config_id` (sync_protocol.md §7.2, historique des politiques effectives). Une entrée.
/// par `config_id` encore admissible ; la dernière en vigueur porte `in_force = true`.
///
@JsonSerializable()
class EdgeDeviceConfig {
  const EdgeDeviceConfig({
    required this.configId,
    required this.deviceId,
    required this.inForce,
    required this.offlinePolicy,
  });

  factory EdgeDeviceConfig.fromJson(Map<String, Object?> json) =>
      _$EdgeDeviceConfigFromJson(json);

  @JsonKey(name: 'config_id')
  final int configId;
  @JsonKey(name: 'device_id')
  final String deviceId;
  @JsonKey(name: 'in_force')
  final bool inForce;
  @JsonKey(name: 'offline_policy')
  final OfflinePolicy offlinePolicy;

  Map<String, Object?> toJson() => _$EdgeDeviceConfigToJson(this);
}
