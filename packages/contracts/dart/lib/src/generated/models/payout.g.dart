// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payout.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Payout _$PayoutFromJson(Map<String, dynamic> json) => Payout(
  payoutId: json['payout_id'] as String,
  ledgerId: json['ledger_id'] as String,
  approvalRequestId: json['approval_request_id'] as String,
  beneficiaryPartyId: json['beneficiary_party_id'] as String,
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  method: $enumDecode(_$PayoutMethodEnumMap, json['method']),
  status: $enumDecode(_$PayoutStatusEnumMap, json['status']),
  initiatedAt: DateTime.parse(json['initiated_at'] as String),
  initiatedBy: json['initiated_by'] as String,
  approvedBy: json['approved_by'] as String,
  externalReference: json['external_reference'] as String?,
  failureReason: json['failure_reason'] as String?,
  confirmedBy: json['confirmed_by'] as String?,
  confirmedAt: json['confirmed_at'] == null
      ? null
      : DateTime.parse(json['confirmed_at'] as String),
  initiatedTransactionId: json['initiated_transaction_id'] as String?,
  settledTransactionId: json['settled_transaction_id'] as String?,
);

Map<String, dynamic> _$PayoutToJson(Payout instance) => <String, dynamic>{
  'payout_id': instance.payoutId,
  'ledger_id': instance.ledgerId,
  'approval_request_id': instance.approvalRequestId,
  'beneficiary_party_id': instance.beneficiaryPartyId,
  'amount': instance.amount,
  'currency': instance.currency,
  'method': instance.method,
  'status': instance.status,
  'external_reference': instance.externalReference,
  'failure_reason': instance.failureReason,
  'initiated_at': instance.initiatedAt.toIso8601String(),
  'initiated_by': instance.initiatedBy,
  'approved_by': instance.approvedBy,
  'confirmed_by': instance.confirmedBy,
  'confirmed_at': instance.confirmedAt?.toIso8601String(),
  'initiated_transaction_id': instance.initiatedTransactionId,
  'settled_transaction_id': instance.settledTransactionId,
};

const _$PayoutMethodEnumMap = {
  PayoutMethod.bankTransfer: 'BANK_TRANSFER',
  PayoutMethod.wave: 'WAVE',
  PayoutMethod.orangeMoney: 'ORANGE_MONEY',
  PayoutMethod.cash: 'CASH',
};

const _$PayoutStatusEnumMap = {
  PayoutStatus.initiated: 'INITIATED',
  PayoutStatus.confirmed: 'CONFIRMED',
  PayoutStatus.failed: 'FAILED',
};
