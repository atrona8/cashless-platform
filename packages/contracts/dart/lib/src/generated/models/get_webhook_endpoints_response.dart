// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'page_meta.dart';
import 'webhook_endpoint.dart';

part 'get_webhook_endpoints_response.g.dart';

@JsonSerializable()
class GetWebhookEndpointsResponse {
  const GetWebhookEndpointsResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetWebhookEndpointsResponse.fromJson(Map<String, Object?> json) =>
      _$GetWebhookEndpointsResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<WebhookEndpoint> data;

  Map<String, Object?> toJson() => _$GetWebhookEndpointsResponseToJson(this);
}
