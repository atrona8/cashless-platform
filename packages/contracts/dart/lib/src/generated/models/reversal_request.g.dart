// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'reversal_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ReversalRequest _$ReversalRequestFromJson(Map<String, dynamic> json) =>
    ReversalRequest(
      reason: $enumDecode(_$ReversalRequestReasonEnumMap, json['reason']),
      occurredAt: DateTime.parse(json['occurred_at'] as String),
      comment: json['comment'] as String?,
      vendorSessionId: json['vendor_session_id'] as String?,
      supervisorPinProof: json['supervisor_pin_proof'] as String?,
    );

Map<String, dynamic> _$ReversalRequestToJson(ReversalRequest instance) =>
    <String, dynamic>{
      'reason': instance.reason,
      'comment': instance.comment,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'vendor_session_id': instance.vendorSessionId,
      'supervisor_pin_proof': instance.supervisorPinProof,
    };

const _$ReversalRequestReasonEnumMap = {
  ReversalRequestReason.inputError: 'INPUT_ERROR',
  ReversalRequestReason.customerCancelled: 'CUSTOMER_CANCELLED',
  ReversalRequestReason.productUnavailable: 'PRODUCT_UNAVAILABLE',
  ReversalRequestReason.duplicate: 'DUPLICATE',
  ReversalRequestReason.other: 'OTHER',
};
