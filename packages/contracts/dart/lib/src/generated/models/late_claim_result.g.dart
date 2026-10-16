// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'late_claim_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LateClaimResult _$LateClaimResultFromJson(Map<String, dynamic> json) =>
    LateClaimResult(
      ledgerId: json['ledger_id'] as String,
      walletId: json['wallet_id'] as String,
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      breakageReversalTransactionId:
          json['breakage_reversal_transaction_id'] as String,
      walletRefundTransactionId: json['wallet_refund_transaction_id'] as String,
      approvedBy: json['approved_by'] as String,
    );

Map<String, dynamic> _$LateClaimResultToJson(
  LateClaimResult instance,
) => <String, dynamic>{
  'ledger_id': instance.ledgerId,
  'wallet_id': instance.walletId,
  'amount': instance.amount,
  'currency': instance.currency,
  'breakage_reversal_transaction_id': instance.breakageReversalTransactionId,
  'wallet_refund_transaction_id': instance.walletRefundTransactionId,
  'approved_by': instance.approvedBy,
};
