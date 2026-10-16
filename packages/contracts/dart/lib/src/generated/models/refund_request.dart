// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'destination3.dart';
import 'refund_request_status.dart';
import 'timestamp.dart';

part 'refund_request.g.dart';

@JsonSerializable()
class RefundRequest {
  const RefundRequest({
    required this.refundRequestId,
    required this.walletId,
    required this.status,
    required this.currency,
    required this.destination,
    required this.createdAt,
    this.estimatedAmount,
    this.fee,
    this.transactionId,
    this.approvedBy,
    this.newNumber,
    this.holdUntil,
    this.extraCheckRequired,
    this.externalReference,
    this.failureReason,
    this.reversalTransactionId,
    this.rejectReason,
  });

  factory RefundRequest.fromJson(Map<String, Object?> json) =>
      _$RefundRequestFromJson(json);

  @JsonKey(name: 'refund_request_id')
  final String refundRequestId;
  @JsonKey(name: 'wallet_id')
  final String walletId;
  final RefundRequestStatus status;
  @JsonKey(name: 'estimated_amount')
  final int? estimatedAmount;
  final int? fee;
  final Currency currency;
  final Destination3 destination;

  /// Transaction `WALLET_REFUND` écrite à l'approbation.
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  /// Seconde personne ayant approuvé (≠ auteur).
  @JsonKey(name: 'approved_by')
  final String? approvedBy;

  /// Destination différente du numéro vérifié du titulaire (ADR-76).
  @JsonKey(name: 'new_number')
  final bool? newNumber;

  /// Fin de l'attente de la décision du titulaire (`AWAITING_HOLDER`).
  @JsonKey(name: 'hold_until')
  final DateTime? holdUntil;

  /// Montant au-delà de `event.refund_new_number_max` vers un autre numéro : vérification d'identité exigée avant approbation.
  @JsonKey(name: 'extra_check_required')
  final bool? extraCheckRequired;

  /// Référence du paiement hors système (renseignée à la confirmation `PAID`).
  @JsonKey(name: 'external_reference')
  final String? externalReference;
  @JsonKey(name: 'failure_reason')
  final String? failureReason;

  /// Contre-passation (`REVERSAL`) de `WALLET_REFUND` si le paiement a échoué.
  @JsonKey(name: 'reversal_transaction_id')
  final String? reversalTransactionId;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'reject_reason')
  final String? rejectReason;

  Map<String, Object?> toJson() => _$RefundRequestToJson(this);
}
