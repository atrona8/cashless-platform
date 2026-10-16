// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'event_status.dart';

part 'status_transition.g.dart';

@JsonSerializable()
class StatusTransition {
  const StatusTransition({required this.to});

  factory StatusTransition.fromJson(Map<String, Object?> json) =>
      _$StatusTransitionFromJson(json);

  final EventStatus to;

  Map<String, Object?> toJson() => _$StatusTransitionToJson(this);
}
