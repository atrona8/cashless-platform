// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'cash_session.dart';

part 'get_events_event_id_cash_sessions_response.g.dart';

@JsonSerializable()
class GetEventsEventIdCashSessionsResponse {
  const GetEventsEventIdCashSessionsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetEventsEventIdCashSessionsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetEventsEventIdCashSessionsResponseFromJson(json);

  final List<CashSession> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetEventsEventIdCashSessionsResponseToJson(this);
}
