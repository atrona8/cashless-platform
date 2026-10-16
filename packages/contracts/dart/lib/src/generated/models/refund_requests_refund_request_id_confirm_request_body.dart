// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'outcome.dart';

part 'refund_requests_refund_request_id_confirm_request_body.g.dart';

@JsonSerializable()
class RefundRequestsRefundRequestIdConfirmRequestBody {
  const RefundRequestsRefundRequestIdConfirmRequestBody({
    required this.outcome,
    this.externalReference,
    this.failureReason,
  });

  factory RefundRequestsRefundRequestIdConfirmRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$RefundRequestsRefundRequestIdConfirmRequestBodyFromJson(json);

  final Outcome outcome;

  /// Obligatoire si `outcome = PAID`.
  @JsonKey(name: 'external_reference')
  final String? externalReference;

  /// Obligatoire si `outcome = FAILED`.
  @JsonKey(name: 'failure_reason')
  final String? failureReason;

  Map<String, Object?> toJson() =>
      _$RefundRequestsRefundRequestIdConfirmRequestBodyToJson(this);
}
