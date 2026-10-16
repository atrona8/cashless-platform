// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_events_event_id_device_sync_status_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetEventsEventIdDeviceSyncStatusResponse
_$GetEventsEventIdDeviceSyncStatusResponseFromJson(Map<String, dynamic> json) =>
    GetEventsEventIdDeviceSyncStatusResponse(
      syncDeadline: json['sync_deadline'] == null
          ? null
          : DateTime.parse(json['sync_deadline'] as String),
      devices: (json['devices'] as List<dynamic>)
          .map((e) => Devices.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetEventsEventIdDeviceSyncStatusResponseToJson(
  GetEventsEventIdDeviceSyncStatusResponse instance,
) => <String, dynamic>{
  'sync_deadline': instance.syncDeadline?.toIso8601String(),
  'devices': instance.devices,
};
