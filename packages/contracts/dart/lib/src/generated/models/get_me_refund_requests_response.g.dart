// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_me_refund_requests_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetMeRefundRequestsResponse _$GetMeRefundRequestsResponseFromJson(
  Map<String, dynamic> json,
) => GetMeRefundRequestsResponse(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
  data: (json['data'] as List<dynamic>)
      .map((e) => RefundRequest.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetMeRefundRequestsResponseToJson(
  GetMeRefundRequestsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
