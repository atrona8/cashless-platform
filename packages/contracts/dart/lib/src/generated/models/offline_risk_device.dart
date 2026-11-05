// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'offline_risk_device.g.dart';

@JsonSerializable()
class OfflineRiskDevice {
  const OfflineRiskDevice({
    required this.deviceId,
    required this.serial,
    required this.maxTotalPerDevice,
    required this.capped,
  });

  factory OfflineRiskDevice.fromJson(Map<String, Object?> json) =>
      _$OfflineRiskDeviceFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final String serial;
  @JsonKey(name: 'max_total_per_device')
  final int maxTotalPerDevice;

  /// Vrai si le plafond prestataire a réduit l'un des trois montants de ce terminal.
  final bool capped;

  Map<String, Object?> toJson() => _$OfflineRiskDeviceToJson(this);
}
