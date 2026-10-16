// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'webhook_endpoint.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WebhookEndpoint _$WebhookEndpointFromJson(Map<String, dynamic> json) =>
    WebhookEndpoint(
      webhookEndpointId: json['webhook_endpoint_id'] as String,
      url: json['url'] as String,
      events: (json['events'] as List<dynamic>)
          .map((e) => $enumDecode(_$OutboundEventTypeEnumMap, e))
          .toList(),
      createdAt: DateTime.parse(json['created_at'] as String),
      secret: json['secret'] as String?,
    );

Map<String, dynamic> _$WebhookEndpointToJson(WebhookEndpoint instance) =>
    <String, dynamic>{
      'webhook_endpoint_id': instance.webhookEndpointId,
      'url': instance.url,
      'events': instance.events,
      'secret': instance.secret,
      'created_at': instance.createdAt.toIso8601String(),
    };

const _$OutboundEventTypeEnumMap = {
  OutboundEventType.undefined0: 'payment_intent.authorized',
  OutboundEventType.undefined1: 'payment_intent.succeeded',
  OutboundEventType.undefined2: 'payment_intent.cancelled',
  OutboundEventType.undefined3: 'payment_intent.expired',
  OutboundEventType.undefined4: 'payment_intent.failed',
  OutboundEventType.undefined5: 'payment_intent.reversed',
};
