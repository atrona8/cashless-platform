// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'offline_risk_device.dart';
import 'timestamp.dart';

part 'offline_risk.g.dart';

/// Exposition maximale hors ligne d'un événement : somme des plafonds `max_total_per_device` des terminaux.
/// autorisés hors ligne.
///
@JsonSerializable()
class OfflineRisk {
  const OfflineRisk({
    required this.eventId,
    required this.currency,
    required this.maxTotalRisk,
    required this.offlineDevices,
    required this.devices,
    required this.computedAt,
  });

  factory OfflineRisk.fromJson(Map<String, Object?> json) =>
      _$OfflineRiskFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final Currency currency;
  @JsonKey(name: 'max_total_risk')
  final int maxTotalRisk;

  /// Nombre de terminaux autorisés hors ligne.
  @JsonKey(name: 'offline_devices')
  final int offlineDevices;
  final List<OfflineRiskDevice> devices;
  @JsonKey(name: 'computed_at')
  final Timestamp computedAt;

  Map<String, Object?> toJson() => _$OfflineRiskToJson(this);
}
