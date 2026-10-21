// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'device_status_change_request.g.dart';

@JsonSerializable()
class DeviceStatusChangeRequest {
  const DeviceStatusChangeRequest({required this.reason});

  factory DeviceStatusChangeRequest.fromJson(Map<String, Object?> json) =>
      _$DeviceStatusChangeRequestFromJson(json);

  /// Motif du changement de statut (historique et audit).
  final String reason;

  Map<String, Object?> toJson() => _$DeviceStatusChangeRequestToJson(this);
}
