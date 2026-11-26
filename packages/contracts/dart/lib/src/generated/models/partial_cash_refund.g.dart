// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'partial_cash_refund.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PartialCashRefund _$PartialCashRefundFromJson(Map<String, dynamic> json) =>
    PartialCashRefund(
      transactionId: json['transaction_id'] as String,
      mediaId: json['media_id'] as String,
      walletId: json['wallet_id'] as String,
      amountDebited: (json['amount_debited'] as num).toInt(),
      fee: (json['fee'] as num).toInt(),
      cashHanded: (json['cash_handed'] as num).toInt(),
      paidBalanceAfter: (json['paid_balance_after'] as num).toInt(),
      dayCumulative: (json['day_cumulative'] as num).toInt(),
      approvedBy: json['approved_by'] as String?,
      cashSessionId: json['cash_session_id'] as String,
    );

Map<String, dynamic> _$PartialCashRefundToJson(PartialCashRefund instance) =>
    <String, dynamic>{
      'transaction_id': instance.transactionId,
      'media_id': instance.mediaId,
      'wallet_id': instance.walletId,
      'amount_debited': instance.amountDebited,
      'fee': instance.fee,
      'cash_handed': instance.cashHanded,
      'paid_balance_after': instance.paidBalanceAfter,
      'day_cumulative': instance.dayCumulative,
      'approved_by': instance.approvedBy,
      'cash_session_id': instance.cashSessionId,
    };
