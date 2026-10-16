// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_refund_requests_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetRefundRequestsResponse _$GetRefundRequestsResponseFromJson(
  Map<String, dynamic> json,
) => GetRefundRequestsResponse(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
  data: (json['data'] as List<dynamic>)
      .map((e) => RefundRequest.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetRefundRequestsResponseToJson(
  GetRefundRequestsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
