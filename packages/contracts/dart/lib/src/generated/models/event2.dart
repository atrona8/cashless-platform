// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'event2.g.dart';

@JsonSerializable()
class Event2 {
  const Event2({
    required this.eventId,
    required this.name,
    required this.status,
  });

  factory Event2.fromJson(Map<String, Object?> json) => _$Event2FromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final String name;
  final String status;

  Map<String, Object?> toJson() => _$Event2ToJson(this);
}
