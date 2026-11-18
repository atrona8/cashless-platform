// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'statement_line_match.g.dart';

/// Cible d'un rapprochement manuel. Exactement l'un des deux champs (sinon `422 VALIDATION_FAILED`).
@JsonSerializable()
class StatementLineMatch {
  const StatementLineMatch({this.transactionId, this.anomalyId});

  factory StatementLineMatch.fromJson(Map<String, Object?> json) =>
      _$StatementLineMatchFromJson(json);

  /// Transaction du même prestataire et du même grand livre qui mouvemente le compte de la ligne.
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  /// Anomalie ouverte (`PSP_TOPUP_OVER_LIMIT`, `PSP_TOPUP_NOT_CREDITED`, `PSP_MISMATCH`) qui explique l'écart.
  @JsonKey(name: 'anomaly_id')
  final String? anomalyId;

  Map<String, Object?> toJson() => _$StatementLineMatchToJson(this);
}
