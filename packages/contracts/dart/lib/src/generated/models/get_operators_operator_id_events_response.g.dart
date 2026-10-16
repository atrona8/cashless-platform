// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_events_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdEventsResponse
_$GetOperatorsOperatorIdEventsResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdEventsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => Event.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdEventsResponseToJson(
  GetOperatorsOperatorIdEventsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
