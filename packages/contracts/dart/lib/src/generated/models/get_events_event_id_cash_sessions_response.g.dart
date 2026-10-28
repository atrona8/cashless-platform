// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_events_event_id_cash_sessions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetEventsEventIdCashSessionsResponse
_$GetEventsEventIdCashSessionsResponseFromJson(Map<String, dynamic> json) =>
    GetEventsEventIdCashSessionsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => CashSession.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetEventsEventIdCashSessionsResponseToJson(
  GetEventsEventIdCashSessionsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
