// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'psp_webhook_event.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PspWebhookEvent _$PspWebhookEventFromJson(Map<String, dynamic> json) =>
    PspWebhookEvent(
      id: json['id'] as String,
      type: json['type'] as String,
      data: json['data'],
    );

Map<String, dynamic> _$PspWebhookEventToJson(PspWebhookEvent instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'data': instance.data,
    };
