// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'account_reconciliation.dart';

part 'get_ledgers_ledger_id_reconciliation_response.g.dart';

@JsonSerializable()
class GetLedgersLedgerIdReconciliationResponse {
  const GetLedgersLedgerIdReconciliationResponse({required this.data});

  factory GetLedgersLedgerIdReconciliationResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetLedgersLedgerIdReconciliationResponseFromJson(json);

  final List<AccountReconciliation> data;

  Map<String, Object?> toJson() =>
      _$GetLedgersLedgerIdReconciliationResponseToJson(this);
}
