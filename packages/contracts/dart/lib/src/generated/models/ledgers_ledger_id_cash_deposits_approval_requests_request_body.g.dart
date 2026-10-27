// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ledgers_ledger_id_cash_deposits_approval_requests_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LedgersLedgerIdCashDepositsApprovalRequestsRequestBody
_$LedgersLedgerIdCashDepositsApprovalRequestsRequestBodyFromJson(
  Map<String, dynamic> json,
) => LedgersLedgerIdCashDepositsApprovalRequestsRequestBody(
  amount: (json['amount'] as num).toInt(),
  bankReference: json['bank_reference'] as String,
);

Map<String, dynamic>
_$LedgersLedgerIdCashDepositsApprovalRequestsRequestBodyToJson(
  LedgersLedgerIdCashDepositsApprovalRequestsRequestBody instance,
) => <String, dynamic>{
  'amount': instance.amount,
  'bank_reference': instance.bankReference,
};
