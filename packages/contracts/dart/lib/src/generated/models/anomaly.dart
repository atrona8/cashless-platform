// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'anomaly_kind.dart';
import 'anomaly_status.dart';
import 'classification.dart';
import 'timestamp.dart';

part 'anomaly.g.dart';

/// Anomalie vue du back-office. Montant en unités mineures de `currency` ; `event_id`, `amount` et `currency`.
/// sont `null` quand l'anomalie n'a pas de grand livre. `classification` n'est présente que pour une anomalie.
/// classée (`classifyAnomaly`).
///
@JsonSerializable()
class Anomaly {
  const Anomaly({
    required this.anomalyId,
    required this.kind,
    required this.status,
    required this.eventId,
    required this.createdAt,
    required this.amount,
    required this.currency,
    required this.mediaId,
    required this.deviceId,
    required this.transactionId,
    required this.classifiable,
    this.classification,
  });

  factory Anomaly.fromJson(Map<String, Object?> json) =>
      _$AnomalyFromJson(json);

  @JsonKey(name: 'anomaly_id')
  final String anomalyId;
  final AnomalyKind kind;
  final AnomalyStatus status;
  @JsonKey(name: 'event_id')
  final String? eventId;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  final int? amount;
  final String? currency;
  @JsonKey(name: 'media_id')
  final String? mediaId;
  @JsonKey(name: 'device_id')
  final String? deviceId;
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  /// Vrai si le type admet un classement sans écriture au grand livre.
  final bool classifiable;
  final Classification? classification;

  Map<String, Object?> toJson() => _$AnomalyToJson(this);
}
