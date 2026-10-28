// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_events_event_id_psp_selections_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetEventsEventIdPspSelectionsResponse
_$GetEventsEventIdPspSelectionsResponseFromJson(Map<String, dynamic> json) =>
    GetEventsEventIdPspSelectionsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => EventPspSelection.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetEventsEventIdPspSelectionsResponseToJson(
  GetEventsEventIdPspSelectionsResponse instance,
) => <String, dynamic>{'data': instance.data};
