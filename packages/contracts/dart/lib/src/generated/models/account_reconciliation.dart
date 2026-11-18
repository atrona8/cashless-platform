// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';

part 'account_reconciliation.g.dart';

/// État du rapprochement d'un compte d'argent.
@JsonSerializable()
class AccountReconciliation {
  const AccountReconciliation({
    required this.accountId,
    required this.currency,
    required this.linesTotal,
    required this.linesUnmatched,
    required this.ledgerBalance,
    required this.reconciled,
    this.statementDate,
    this.statementBalance,
  });

  factory AccountReconciliation.fromJson(Map<String, Object?> json) =>
      _$AccountReconciliationFromJson(json);

  @JsonKey(name: 'account_id')
  final String accountId;
  final Currency currency;
  @JsonKey(name: 'lines_total')
  final int linesTotal;
  @JsonKey(name: 'lines_unmatched')
  final int linesUnmatched;

  /// Date du dernier relevé importé.
  @JsonKey(name: 'statement_date')
  final DateTime? statementDate;

  /// Solde de clôture du dernier relevé ; nul sans relevé.
  @JsonKey(name: 'statement_balance')
  final int? statementBalance;

  /// Solde du compte au grand livre à la date du relevé.
  @JsonKey(name: 'ledger_balance')
  final int ledgerBalance;

  /// Toutes les lignes rapprochées, et solde du relevé égal au solde du grand livre.
  final bool reconciled;

  Map<String, Object?> toJson() => _$AccountReconciliationToJson(this);
}
