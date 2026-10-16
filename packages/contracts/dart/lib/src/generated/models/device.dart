// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_kind.dart';
import 'device_app_mode.dart';
import 'os.dart';
import 'device_status.dart';

part 'device.g.dart';

@JsonSerializable()
class Device {
  const Device({
    required this.deviceId,
    required this.serial,
    required this.kind,
    required this.appMode,
    required this.os,
    required this.nfcEnabled,
    required this.status,
    this.stationName,
  });

  factory Device.fromJson(Map<String, Object?> json) => _$DeviceFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final String serial;
  final DeviceKind kind;
  @JsonKey(name: 'app_mode')
  final DeviceAppMode appMode;
  final Os os;
  @JsonKey(name: 'nfc_enabled')
  final bool nfcEnabled;
  final DeviceStatus status;
  @JsonKey(name: 'station_name')
  final String? stationName;

  Map<String, Object?> toJson() => _$DeviceToJson(this);
}
