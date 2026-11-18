// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'closing_step.dart';
import 'currency.dart';
import 'lines.dart';
import 'signed_amount.dart';

part 'closing_step_preview.g.dart';

/// Ce qu'une étape écrirait, sans rien écrire.
@JsonSerializable()
class ClosingStepPreview {
  const ClosingStepPreview({
    required this.eventId,
    required this.step,
    required this.currency,
    required this.applicable,
    required this.lines,
    required this.total,
  });

  factory ClosingStepPreview.fromJson(Map<String, Object?> json) =>
      _$ClosingStepPreviewFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final ClosingStep step;
  final Currency currency;

  /// `false` : l'exécution marquerait l'étape sans objet.
  final bool applicable;
  final List<Lines> lines;
  final SignedAmount total;

  Map<String, Object?> toJson() => _$ClosingStepPreviewToJson(this);
}
