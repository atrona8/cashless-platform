// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'outbound_event_type.dart';
import 'timestamp.dart';

part 'webhook_endpoint.g.dart';

@JsonSerializable()
class WebhookEndpoint {
  const WebhookEndpoint({
    required this.webhookEndpointId,
    required this.url,
    required this.events,
    required this.createdAt,
    this.secret,
  });

  factory WebhookEndpoint.fromJson(Map<String, Object?> json) =>
      _$WebhookEndpointFromJson(json);

  @JsonKey(name: 'webhook_endpoint_id')
  final String webhookEndpointId;
  final String url;
  final List<OutboundEventType> events;

  /// Renvoyé uniquement à la création.
  final String? secret;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;

  Map<String, Object?> toJson() => _$WebhookEndpointToJson(this);
}
