// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';

part 'ledgers_ledger_id_cash_deposits_approval_requests_request_body.g.dart';

@JsonSerializable()
class LedgersLedgerIdCashDepositsApprovalRequestsRequestBody {
  const LedgersLedgerIdCashDepositsApprovalRequestsRequestBody({
    required this.amount,
    required this.bankReference,
  });

  factory LedgersLedgerIdCashDepositsApprovalRequestsRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$LedgersLedgerIdCashDepositsApprovalRequestsRequestBodyFromJson(json);

  final Amount amount;

  /// Référence du bordereau de dépôt en banque.
  @JsonKey(name: 'bank_reference')
  final String bankReference;

  Map<String, Object?> toJson() =>
      _$LedgersLedgerIdCashDepositsApprovalRequestsRequestBodyToJson(this);
}
