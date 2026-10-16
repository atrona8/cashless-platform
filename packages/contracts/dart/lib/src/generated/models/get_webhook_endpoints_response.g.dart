// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_webhook_endpoints_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetWebhookEndpointsResponse _$GetWebhookEndpointsResponseFromJson(
  Map<String, dynamic> json,
) => GetWebhookEndpointsResponse(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
  data: (json['data'] as List<dynamic>)
      .map((e) => WebhookEndpoint.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetWebhookEndpointsResponseToJson(
  GetWebhookEndpointsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
