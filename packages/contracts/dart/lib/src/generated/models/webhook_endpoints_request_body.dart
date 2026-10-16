// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'outbound_event_type.dart';

part 'webhook_endpoints_request_body.g.dart';

@JsonSerializable()
class WebhookEndpointsRequestBody {
  const WebhookEndpointsRequestBody({required this.url, required this.events});

  factory WebhookEndpointsRequestBody.fromJson(Map<String, Object?> json) =>
      _$WebhookEndpointsRequestBodyFromJson(json);

  final String url;
  final List<OutboundEventType> events;

  Map<String, Object?> toJson() => _$WebhookEndpointsRequestBodyToJson(this);
}
