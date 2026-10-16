// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'refund_requests_refund_request_id_reject_request_body.g.dart';

@JsonSerializable()
class RefundRequestsRefundRequestIdRejectRequestBody {
  const RefundRequestsRefundRequestIdRejectRequestBody({required this.reason});

  factory RefundRequestsRefundRequestIdRejectRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$RefundRequestsRefundRequestIdRejectRequestBodyFromJson(json);

  final String reason;

  Map<String, Object?> toJson() =>
      _$RefundRequestsRefundRequestIdRejectRequestBodyToJson(this);
}
