// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_events_event_id_closing_steps_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdEventsEventIdClosingStepsResponse
_$GetOperatorsOperatorIdEventsEventIdClosingStepsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdEventsEventIdClosingStepsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => ClosingStepState.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic>
_$GetOperatorsOperatorIdEventsEventIdClosingStepsResponseToJson(
  GetOperatorsOperatorIdEventsEventIdClosingStepsResponse instance,
) => <String, dynamic>{'data': instance.data};
