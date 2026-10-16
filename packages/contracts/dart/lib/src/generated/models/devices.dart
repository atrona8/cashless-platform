// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'reason.dart';

part 'devices.g.dart';

@JsonSerializable()
class Devices {
  const Devices({
    required this.deviceId,
    required this.serial,
    required this.caughtUp,
    this.reason,
  });

  factory Devices.fromJson(Map<String, Object?> json) =>
      _$DevicesFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final String serial;
  @JsonKey(name: 'caught_up')
  final bool caughtUp;
  final Reason? reason;

  Map<String, Object?> toJson() => _$DevicesToJson(this);
}
