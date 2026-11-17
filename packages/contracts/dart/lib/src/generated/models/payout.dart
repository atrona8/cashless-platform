// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'payout_method.dart';
import 'payout_status.dart';

part 'payout.g.dart';

/// Versement. Ne porte jamais l'IBAN ni le numéro : ils ne sortent que du CSV d'`exportPayoutBatch`.
@JsonSerializable()
class Payout {
  const Payout({
    required this.payoutId,
    required this.ledgerId,
    required this.approvalRequestId,
    required this.beneficiaryPartyId,
    required this.amount,
    required this.currency,
    required this.method,
    required this.status,
    required this.initiatedAt,
    required this.initiatedBy,
    required this.approvedBy,
    this.externalReference,
    this.failureReason,
    this.confirmedBy,
    this.confirmedAt,
    this.initiatedTransactionId,
    this.settledTransactionId,
  });

  factory Payout.fromJson(Map<String, Object?> json) => _$PayoutFromJson(json);

  @JsonKey(name: 'payout_id')
  final String payoutId;
  @JsonKey(name: 'ledger_id')
  final String ledgerId;

  /// Lot (demande d'approbation `PAYOUT`).
  @JsonKey(name: 'approval_request_id')
  final String approvalRequestId;
  @JsonKey(name: 'beneficiary_party_id')
  final String beneficiaryPartyId;
  final Amount amount;
  final Currency currency;
  final PayoutMethod method;
  final PayoutStatus status;
  @JsonKey(name: 'external_reference')
  final String? externalReference;
  @JsonKey(name: 'failure_reason')
  final String? failureReason;
  @JsonKey(name: 'initiated_at')
  final DateTime initiatedAt;
  @JsonKey(name: 'initiated_by')
  final String initiatedBy;
  @JsonKey(name: 'approved_by')
  final String approvedBy;
  @JsonKey(name: 'confirmed_by')
  final String? confirmedBy;
  @JsonKey(name: 'confirmed_at')
  final DateTime? confirmedAt;
  @JsonKey(name: 'initiated_transaction_id')
  final String? initiatedTransactionId;
  @JsonKey(name: 'settled_transaction_id')
  final String? settledTransactionId;

  Map<String, Object?> toJson() => _$PayoutToJson(this);
}
