// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'statement_line.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatementLine _$StatementLineFromJson(Map<String, dynamic> json) =>
    StatementLine(
      statementLineId: (json['statement_line_id'] as num).toInt(),
      ledgerId: json['ledger_id'] as String,
      accountId: json['account_id'] as String,
      source: json['source'] as String,
      externalRef: json['external_ref'] as String,
      valueDate: DateTime.parse(json['value_date'] as String),
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      matched: json['matched'] as bool,
      statementImportId: json['statement_import_id'] as String?,
      matchedTransactionId: json['matched_transaction_id'] as String?,
      matchedAnomalyId: json['matched_anomaly_id'] as String?,
      matchedBy: json['matched_by'] as String?,
      matchedAt: json['matched_at'] == null
          ? null
          : DateTime.parse(json['matched_at'] as String),
    );

Map<String, dynamic> _$StatementLineToJson(StatementLine instance) =>
    <String, dynamic>{
      'statement_line_id': instance.statementLineId,
      'ledger_id': instance.ledgerId,
      'account_id': instance.accountId,
      'statement_import_id': instance.statementImportId,
      'source': instance.source,
      'external_ref': instance.externalRef,
      'value_date': instance.valueDate.toIso8601String(),
      'amount': instance.amount,
      'currency': instance.currency,
      'matched': instance.matched,
      'matched_transaction_id': instance.matchedTransactionId,
      'matched_anomaly_id': instance.matchedAnomalyId,
      'matched_by': instance.matchedBy,
      'matched_at': instance.matchedAt?.toIso8601String(),
    };
