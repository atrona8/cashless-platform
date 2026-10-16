// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'webhook_endpoints_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WebhookEndpointsRequestBody _$WebhookEndpointsRequestBodyFromJson(
  Map<String, dynamic> json,
) => WebhookEndpointsRequestBody(
  url: json['url'] as String,
  events: (json['events'] as List<dynamic>)
      .map((e) => $enumDecode(_$OutboundEventTypeEnumMap, e))
      .toList(),
);

Map<String, dynamic> _$WebhookEndpointsRequestBodyToJson(
  WebhookEndpointsRequestBody instance,
) => <String, dynamic>{'url': instance.url, 'events': instance.events};

const _$OutboundEventTypeEnumMap = {
  OutboundEventType.undefined0: 'payment_intent.authorized',
  OutboundEventType.undefined1: 'payment_intent.succeeded',
  OutboundEventType.undefined2: 'payment_intent.cancelled',
  OutboundEventType.undefined3: 'payment_intent.expired',
  OutboundEventType.undefined4: 'payment_intent.failed',
  OutboundEventType.undefined5: 'payment_intent.reversed',
};
