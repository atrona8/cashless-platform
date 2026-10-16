// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'page_meta.dart';
import 'refund_request.dart';

part 'get_me_refund_requests_response.g.dart';

@JsonSerializable()
class GetMeRefundRequestsResponse {
  const GetMeRefundRequestsResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetMeRefundRequestsResponse.fromJson(Map<String, Object?> json) =>
      _$GetMeRefundRequestsResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<RefundRequest> data;

  Map<String, Object?> toJson() => _$GetMeRefundRequestsResponseToJson(this);
}
