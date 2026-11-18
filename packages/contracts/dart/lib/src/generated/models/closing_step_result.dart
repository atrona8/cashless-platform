// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'closing_step.dart';
import 'closing_step_result_status.dart';

part 'closing_step_result.g.dart';

/// Résultat d'une étape exécutée ; identique si l'étape était déjà faite.
@JsonSerializable()
class ClosingStepResult {
  const ClosingStepResult({
    required this.eventId,
    required this.step,
    required this.status,
    required this.transactionIds,
    this.summary,
    this.doneBy,
    this.doneAt,
  });

  factory ClosingStepResult.fromJson(Map<String, Object?> json) =>
      _$ClosingStepResultFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final ClosingStep step;
  final ClosingStepResultStatus status;
  @JsonKey(name: 'transaction_ids')
  final List<String> transactionIds;
  final dynamic summary;
  @JsonKey(name: 'done_by')
  final String? doneBy;
  @JsonKey(name: 'done_at')
  final DateTime? doneAt;

  Map<String, Object?> toJson() => _$ClosingStepResultToJson(this);
}
