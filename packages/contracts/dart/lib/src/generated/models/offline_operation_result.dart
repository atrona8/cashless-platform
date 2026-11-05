// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_operation_result_effect.dart';
import 'offline_operation_status.dart';
import 'offline_reject_reason.dart';
import 'shortfall_reason.dart';
import 'tap_result_code.dart';

part 'offline_operation_result.g.dart';

@JsonSerializable()
class OfflineOperationResult {
  const OfflineOperationResult({
    required this.seq,
    required this.idempotencyKey,
    required this.status,
    required this.effect,
    required this.retryable,
    this.transactionId,
    this.chargedToWallet,
    this.shortfallAmount,
    this.shortfallReason,
    this.anomalyId,
    this.tapResult,
    this.rejectReason,
    this.detail,
  });

  factory OfflineOperationResult.fromJson(Map<String, Object?> json) =>
      _$OfflineOperationResultFromJson(json);

  final int seq;
  @JsonKey(name: 'idempotency_key')
  final String idempotencyKey;
  final OfflineOperationStatus status;
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  /// NONE pour VOID, ONLINE_REF non exécuté, REJECTED. Un `DUPLICATE` dont l'opération est déjà au journal.
  /// (en ligne, passerelle) vaut `LEDGER_WRITTEN` et porte le `transaction_id` d'origine.
  ///
  final OfflineOperationResultEffect effect;
  @JsonKey(name: 'charged_to_wallet')
  final int? chargedToWallet;
  @JsonKey(name: 'shortfall_amount')
  final int? shortfallAmount;
  @JsonKey(name: 'shortfall_reason')
  final ShortfallReason? shortfallReason;

  /// Identifiant (`anomaly.id`) de l'anomalie ouverte par l'opération, s'il y en a une.
  @JsonKey(name: 'anomaly_id')
  final String? anomalyId;
  @JsonKey(name: 'tap_result')
  final TapResultCode? tapResult;
  @JsonKey(name: 'reject_reason')
  final OfflineRejectReason? rejectReason;

  /// Vrai seulement pour `INSUFFICIENT_FUNDS_RETRY` (le terminal renvoie l'opération dans un lot ultérieur).
  final bool retryable;

  /// Précision lisible, sans secret ni identifiant interne.
  final String? detail;

  Map<String, Object?> toJson() => _$OfflineOperationResultToJson(this);
}
