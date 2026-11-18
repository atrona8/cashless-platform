// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'closing_step_state.dart';

part 'get_operators_operator_id_events_event_id_closing_steps_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdEventsEventIdClosingStepsResponse {
  const GetOperatorsOperatorIdEventsEventIdClosingStepsResponse({
    required this.data,
  });

  factory GetOperatorsOperatorIdEventsEventIdClosingStepsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdEventsEventIdClosingStepsResponseFromJson(json);

  final List<ClosingStepState> data;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdEventsEventIdClosingStepsResponseToJson(this);
}
