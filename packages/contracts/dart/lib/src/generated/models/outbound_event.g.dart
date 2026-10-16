// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'outbound_event.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OutboundEvent _$OutboundEventFromJson(Map<String, dynamic> json) =>
    OutboundEvent(
      eventId: json['event_id'] as String,
      type: $enumDecode(_$OutboundEventTypeEnumMap, json['type']),
      createdAt: DateTime.parse(json['created_at'] as String),
      data: PaymentIntent.fromJson(json['data'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$OutboundEventToJson(OutboundEvent instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'type': instance.type,
      'created_at': instance.createdAt.toIso8601String(),
      'data': instance.data,
    };

const _$OutboundEventTypeEnumMap = {
  OutboundEventType.undefined0: 'payment_intent.authorized',
  OutboundEventType.undefined1: 'payment_intent.succeeded',
  OutboundEventType.undefined2: 'payment_intent.cancelled',
  OutboundEventType.undefined3: 'payment_intent.expired',
  OutboundEventType.undefined4: 'payment_intent.failed',
  OutboundEventType.undefined5: 'payment_intent.reversed',
};
