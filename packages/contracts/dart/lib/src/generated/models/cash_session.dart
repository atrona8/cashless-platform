// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'cash_session_status.dart';
import 'last_count.dart';
import 'timestamp.dart';

part 'cash_session.g.dart';

/// Session de caisse (objet de l'application ; table à créer, SPECIFICATION §14.2).
@JsonSerializable()
class CashSession {
  const CashSession({
    required this.cashSessionId,
    required this.cashAccountId,
    required this.status,
    required this.openedBy,
    required this.openedAt,
    this.deviceId,
    this.lastCount,
    this.closedAt,
    this.cashCloseTransactionId,
    this.difference,
    this.cashDiffAnomalyId,
  });

  factory CashSession.fromJson(Map<String, Object?> json) =>
      _$CashSessionFromJson(json);

  @JsonKey(name: 'cash_session_id')
  final String cashSessionId;
  @JsonKey(name: 'cash_account_id')
  final String cashAccountId;
  @JsonKey(name: 'device_id')
  final String? deviceId;
  final CashSessionStatus status;
  @JsonKey(name: 'opened_by')
  final String openedBy;
  @JsonKey(name: 'opened_at')
  final Timestamp openedAt;
  @JsonKey(name: 'last_count')
  final LastCount? lastCount;
  @JsonKey(name: 'closed_at')
  final DateTime? closedAt;
  @JsonKey(name: 'cash_close_transaction_id')
  final String? cashCloseTransactionId;

  /// Compté − théorique à la fermeture (négatif = manque) ; renvoyé seulement après fermeture.
  final int? difference;
  @JsonKey(name: 'cash_diff_anomaly_id')
  final String? cashDiffAnomalyId;

  Map<String, Object?> toJson() => _$CashSessionToJson(this);
}
