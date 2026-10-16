// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'decision.dart';

part 'refund_requests_refund_request_id_holder_decision_request_body.g.dart';

@JsonSerializable()
class RefundRequestsRefundRequestIdHolderDecisionRequestBody {
  const RefundRequestsRefundRequestIdHolderDecisionRequestBody({
    required this.decision,
    required this.otpRequestId,
    required this.code,
  });

  factory RefundRequestsRefundRequestIdHolderDecisionRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$RefundRequestsRefundRequestIdHolderDecisionRequestBodyFromJson(json);

  final Decision decision;
  @JsonKey(name: 'otp_request_id')
  final String otpRequestId;
  final String code;

  Map<String, Object?> toJson() =>
      _$RefundRequestsRefundRequestIdHolderDecisionRequestBodyToJson(this);
}
