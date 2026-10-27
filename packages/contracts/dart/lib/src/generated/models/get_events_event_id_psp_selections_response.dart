// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'event_psp_selection.dart';

part 'get_events_event_id_psp_selections_response.g.dart';

@JsonSerializable()
class GetEventsEventIdPspSelectionsResponse {
  const GetEventsEventIdPspSelectionsResponse({required this.data});

  factory GetEventsEventIdPspSelectionsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetEventsEventIdPspSelectionsResponseFromJson(json);

  final List<EventPspSelection> data;

  Map<String, Object?> toJson() =>
      _$GetEventsEventIdPspSelectionsResponseToJson(this);
}
