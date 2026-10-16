// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_events_event_id_participations_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdEventsEventIdParticipationsResponse
_$GetOperatorsOperatorIdEventsEventIdParticipationsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdEventsEventIdParticipationsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Participation.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic>
_$GetOperatorsOperatorIdEventsEventIdParticipationsResponseToJson(
  GetOperatorsOperatorIdEventsEventIdParticipationsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
