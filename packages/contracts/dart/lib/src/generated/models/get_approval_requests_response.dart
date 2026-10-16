// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'approval_request.dart';

part 'get_approval_requests_response.g.dart';

@JsonSerializable()
class GetApprovalRequestsResponse {
  const GetApprovalRequestsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetApprovalRequestsResponse.fromJson(Map<String, Object?> json) =>
      _$GetApprovalRequestsResponseFromJson(json);

  final List<ApprovalRequest> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$GetApprovalRequestsResponseToJson(this);
}
