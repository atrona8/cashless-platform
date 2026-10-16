// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_approval_requests_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApprovalRequestsResponse _$GetApprovalRequestsResponseFromJson(
  Map<String, dynamic> json,
) => GetApprovalRequestsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => ApprovalRequest.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetApprovalRequestsResponseToJson(
  GetApprovalRequestsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
