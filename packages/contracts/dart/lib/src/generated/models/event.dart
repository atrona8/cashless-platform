// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'status4.dart';
import 'activation_modes.dart';

part 'event.g.dart';

@JsonSerializable()
class Event {
  const Event({
    required this.eventId,
    required this.name,
    required this.currency,
    required this.minorUnits,
    required this.timezone,
    required this.status,
    required this.activationModes,
  });

  factory Event.fromJson(Map<String, Object?> json) => _$EventFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final String name;
  final Currency currency;
  @JsonKey(name: 'minor_units')
  final int minorUnits;
  final String timezone;
  final Status4 status;
  @JsonKey(name: 'activation_modes')
  final List<ActivationModes> activationModes;

  Map<String, Object?> toJson() => _$EventToJson(this);
}
