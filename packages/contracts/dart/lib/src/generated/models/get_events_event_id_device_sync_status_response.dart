// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'devices.dart';

part 'get_events_event_id_device_sync_status_response.g.dart';

@JsonSerializable()
class GetEventsEventIdDeviceSyncStatusResponse {
  const GetEventsEventIdDeviceSyncStatusResponse({
    required this.syncDeadline,
    required this.devices,
  });

  factory GetEventsEventIdDeviceSyncStatusResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetEventsEventIdDeviceSyncStatusResponseFromJson(json);

  @JsonKey(name: 'sync_deadline')
  final DateTime? syncDeadline;
  final List<Devices> devices;

  Map<String, Object?> toJson() =>
      _$GetEventsEventIdDeviceSyncStatusResponseToJson(this);
}
