// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'account_reconciliation.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AccountReconciliation _$AccountReconciliationFromJson(
  Map<String, dynamic> json,
) => AccountReconciliation(
  accountId: json['account_id'] as String,
  currency: json['currency'] as String,
  linesTotal: (json['lines_total'] as num).toInt(),
  linesUnmatched: (json['lines_unmatched'] as num).toInt(),
  ledgerBalance: (json['ledger_balance'] as num).toInt(),
  reconciled: json['reconciled'] as bool,
  statementDate: json['statement_date'] == null
      ? null
      : DateTime.parse(json['statement_date'] as String),
  statementBalance: (json['statement_balance'] as num?)?.toInt(),
);

Map<String, dynamic> _$AccountReconciliationToJson(
  AccountReconciliation instance,
) => <String, dynamic>{
  'account_id': instance.accountId,
  'currency': instance.currency,
  'lines_total': instance.linesTotal,
  'lines_unmatched': instance.linesUnmatched,
  'statement_date': instance.statementDate?.toIso8601String(),
  'statement_balance': instance.statementBalance,
  'ledger_balance': instance.ledgerBalance,
  'reconciled': instance.reconciled,
};
