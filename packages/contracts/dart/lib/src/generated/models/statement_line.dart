// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'signed_amount.dart';

part 'statement_line.g.dart';

/// Ligne d'un relevé de PSP, de banque ou de mobile money.
@JsonSerializable()
class StatementLine {
  const StatementLine({
    required this.statementLineId,
    required this.ledgerId,
    required this.accountId,
    required this.source,
    required this.externalRef,
    required this.valueDate,
    required this.amount,
    required this.currency,
    required this.matched,
    this.statementImportId,
    this.matchedTransactionId,
    this.matchedAnomalyId,
    this.matchedBy,
    this.matchedAt,
  });

  factory StatementLine.fromJson(Map<String, Object?> json) =>
      _$StatementLineFromJson(json);

  @JsonKey(name: 'statement_line_id')
  final int statementLineId;
  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  @JsonKey(name: 'account_id')
  final String accountId;
  @JsonKey(name: 'statement_import_id')
  final String? statementImportId;
  final String source;
  @JsonKey(name: 'external_ref')
  final String externalRef;
  @JsonKey(name: 'value_date')
  final DateTime valueDate;
  final SignedAmount amount;
  final Currency currency;
  final bool matched;
  @JsonKey(name: 'matched_transaction_id')
  final String? matchedTransactionId;
  @JsonKey(name: 'matched_anomaly_id')
  final String? matchedAnomalyId;

  /// Auteur du rapprochement manuel ; nul pour un rapprochement automatique.
  @JsonKey(name: 'matched_by')
  final String? matchedBy;
  @JsonKey(name: 'matched_at')
  final DateTime? matchedAt;

  Map<String, Object?> toJson() => _$StatementLineToJson(this);
}
