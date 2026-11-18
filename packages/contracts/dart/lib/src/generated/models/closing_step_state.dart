// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'closing_step.dart';
import 'closing_step_state_status.dart';

part 'closing_step_state.g.dart';

/// État d'une étape de clôture pour un événement.
@JsonSerializable()
class ClosingStepState {
  const ClosingStepState({
    required this.step,
    required this.status,
    this.doneBy,
    this.doneAt,
    this.transactionIds,
    this.summary,
  });

  factory ClosingStepState.fromJson(Map<String, Object?> json) =>
      _$ClosingStepStateFromJson(json);

  final ClosingStep step;

  /// `TODO` : aucune ligne `closing_step` ; `DONE` : écritures faites ; `NOT_APPLICABLE` : sans objet.
  final ClosingStepStateStatus status;
  @JsonKey(name: 'done_by')
  final String? doneBy;
  @JsonKey(name: 'done_at')
  final DateTime? doneAt;

  /// Écritures produites (vide si l'étape est sans objet ou à faire).
  @JsonKey(name: 'transaction_ids')
  final List<String>? transactionIds;

  /// Montants par bénéficiaire, tels qu'écrits.
  final dynamic summary;

  Map<String, Object?> toJson() => _$ClosingStepStateToJson(this);
}
