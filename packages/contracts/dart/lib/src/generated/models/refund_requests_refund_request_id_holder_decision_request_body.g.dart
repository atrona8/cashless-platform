// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'refund_requests_refund_request_id_holder_decision_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RefundRequestsRefundRequestIdHolderDecisionRequestBody
_$RefundRequestsRefundRequestIdHolderDecisionRequestBodyFromJson(
  Map<String, dynamic> json,
) => RefundRequestsRefundRequestIdHolderDecisionRequestBody(
  decision: $enumDecode(_$DecisionEnumMap, json['decision']),
  otpRequestId: json['otp_request_id'] as String,
  code: json['code'] as String,
);

Map<String, dynamic>
_$RefundRequestsRefundRequestIdHolderDecisionRequestBodyToJson(
  RefundRequestsRefundRequestIdHolderDecisionRequestBody instance,
) => <String, dynamic>{
  'decision': instance.decision,
  'otp_request_id': instance.otpRequestId,
  'code': instance.code,
};

const _$DecisionEnumMap = {
  Decision.confirm: 'CONFIRM',
  Decision.block: 'BLOCK',
};
