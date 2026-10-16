// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cash_due_refund_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CashDueRefundResult _$CashDueRefundResultFromJson(Map<String, dynamic> json) =>
    CashDueRefundResult(
      transactionId: json['transaction_id'] as String,
      idempotencyKey: json['idempotency_key'] as String,
      mediaId: json['media_id'] as String,
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      resolvedAnomalyIds: (json['resolved_anomaly_ids'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      approvedBy: json['approved_by'] as String?,
    );

Map<String, dynamic> _$CashDueRefundResultToJson(
  CashDueRefundResult instance,
) => <String, dynamic>{
  'transaction_id': instance.transactionId,
  'idempotency_key': instance.idempotencyKey,
  'media_id': instance.mediaId,
  'amount': instance.amount,
  'currency': instance.currency,
  'resolved_anomaly_ids': instance.resolvedAnomalyIds,
  'approved_by': instance.approvedBy,
};
