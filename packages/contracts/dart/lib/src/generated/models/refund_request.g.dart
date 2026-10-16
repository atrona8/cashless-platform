// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'refund_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RefundRequest _$RefundRequestFromJson(Map<String, dynamic> json) =>
    RefundRequest(
      refundRequestId: json['refund_request_id'] as String,
      walletId: json['wallet_id'] as String,
      status: $enumDecode(_$RefundRequestStatusEnumMap, json['status']),
      currency: json['currency'] as String,
      destination: Destination3.fromJson(
        json['destination'] as Map<String, dynamic>,
      ),
      createdAt: DateTime.parse(json['created_at'] as String),
      estimatedAmount: (json['estimated_amount'] as num?)?.toInt(),
      fee: (json['fee'] as num?)?.toInt(),
      transactionId: json['transaction_id'] as String?,
      approvedBy: json['approved_by'] as String?,
      newNumber: json['new_number'] as bool?,
      holdUntil: json['hold_until'] == null
          ? null
          : DateTime.parse(json['hold_until'] as String),
      extraCheckRequired: json['extra_check_required'] as bool?,
      externalReference: json['external_reference'] as String?,
      failureReason: json['failure_reason'] as String?,
      reversalTransactionId: json['reversal_transaction_id'] as String?,
      rejectReason: json['reject_reason'] as String?,
    );

Map<String, dynamic> _$RefundRequestToJson(RefundRequest instance) =>
    <String, dynamic>{
      'refund_request_id': instance.refundRequestId,
      'wallet_id': instance.walletId,
      'status': instance.status,
      'estimated_amount': instance.estimatedAmount,
      'fee': instance.fee,
      'currency': instance.currency,
      'destination': instance.destination,
      'transaction_id': instance.transactionId,
      'approved_by': instance.approvedBy,
      'new_number': instance.newNumber,
      'hold_until': instance.holdUntil?.toIso8601String(),
      'extra_check_required': instance.extraCheckRequired,
      'external_reference': instance.externalReference,
      'failure_reason': instance.failureReason,
      'reversal_transaction_id': instance.reversalTransactionId,
      'created_at': instance.createdAt.toIso8601String(),
      'reject_reason': instance.rejectReason,
    };

const _$RefundRequestStatusEnumMap = {
  RefundRequestStatus.awaitingHolder: 'AWAITING_HOLDER',
  RefundRequestStatus.requested: 'REQUESTED',
  RefundRequestStatus.processing: 'PROCESSING',
  RefundRequestStatus.paid: 'PAID',
  RefundRequestStatus.failed: 'FAILED',
  RefundRequestStatus.rejected: 'REJECTED',
  RefundRequestStatus.cancelled: 'CANCELLED',
  RefundRequestStatus.blocked: 'BLOCKED',
};
