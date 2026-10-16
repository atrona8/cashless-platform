// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'outbound_event_type.dart';
import 'payment_intent.dart';
import 'timestamp.dart';

part 'outbound_event.g.dart';

@JsonSerializable()
class OutboundEvent {
  const OutboundEvent({
    required this.eventId,
    required this.type,
    required this.createdAt,
    required this.data,
  });

  factory OutboundEvent.fromJson(Map<String, Object?> json) =>
      _$OutboundEventFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final OutboundEventType type;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  final PaymentIntent data;

  Map<String, Object?> toJson() => _$OutboundEventToJson(this);
}
