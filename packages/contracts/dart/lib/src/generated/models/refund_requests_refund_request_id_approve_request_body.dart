// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'refund_requests_refund_request_id_approve_request_body.g.dart';

@JsonSerializable()
class RefundRequestsRefundRequestIdApproveRequestBody {
  const RefundRequestsRefundRequestIdApproveRequestBody({this.note});

  factory RefundRequestsRefundRequestIdApproveRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$RefundRequestsRefundRequestIdApproveRequestBodyFromJson(json);

  /// Note de l'auteur, gardée dans la demande d'approbation.
  final String? note;

  Map<String, Object?> toJson() =>
      _$RefundRequestsRefundRequestIdApproveRequestBodyToJson(this);
}
