// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'refund_requests_refund_request_id_confirm_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RefundRequestsRefundRequestIdConfirmRequestBody
_$RefundRequestsRefundRequestIdConfirmRequestBodyFromJson(
  Map<String, dynamic> json,
) => RefundRequestsRefundRequestIdConfirmRequestBody(
  outcome: $enumDecode(_$OutcomeEnumMap, json['outcome']),
  externalReference: json['external_reference'] as String?,
  failureReason: json['failure_reason'] as String?,
);

Map<String, dynamic> _$RefundRequestsRefundRequestIdConfirmRequestBodyToJson(
  RefundRequestsRefundRequestIdConfirmRequestBody instance,
) => <String, dynamic>{
  'outcome': instance.outcome,
  'external_reference': instance.externalReference,
  'failure_reason': instance.failureReason,
};

const _$OutcomeEnumMap = {Outcome.paid: 'PAID', Outcome.failed: 'FAILED'};
