// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'participation.dart';

part 'get_operators_operator_id_events_event_id_participations_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdEventsEventIdParticipationsResponse {
  const GetOperatorsOperatorIdEventsEventIdParticipationsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdEventsEventIdParticipationsResponse.fromJson(
    Map<String, Object?> json,
  ) =>
      _$GetOperatorsOperatorIdEventsEventIdParticipationsResponseFromJson(json);

  final List<Participation> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdEventsEventIdParticipationsResponseToJson(this);
}
