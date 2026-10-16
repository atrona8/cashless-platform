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
    this.transactionId,
    this.effect,
    this.chargedToWallet,
    this.shortfallAmount,
    this.shortfallReason,
    this.anomalyId,
    this.tapResult,
    this.rejectReason,
    this.retryable,
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

  /// NONE pour VOID, ONLINE_REF non exécuté, REJECTED.
  final OfflineOperationResultEffect? effect;
  @JsonKey(name: 'charged_to_wallet')
  final int? chargedToWallet;
  @JsonKey(name: 'shortfall_amount')
  final int? shortfallAmount;
  @JsonKey(name: 'shortfall_reason')
  final ShortfallReason? shortfallReason;
  @JsonKey(name: 'anomaly_id')
  final String? anomalyId;
  @JsonKey(name: 'tap_result')
  final TapResultCode? tapResult;
  @JsonKey(name: 'reject_reason')
  final OfflineRejectReason? rejectReason;
  final bool? retryable;
  final String? detail;

  Map<String, Object?> toJson() => _$OfflineOperationResultToJson(this);
}
