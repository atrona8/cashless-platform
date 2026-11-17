// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'payout_confirm_outcome.dart';

part 'payout_confirm.g.dart';

/// Résultat d'un versement payé hors système. `CONFIRMED` exige `external_reference` ; `FAILED` exige.
/// `failure_reason` (sinon `422 VALIDATION_FAILED`).
///
@JsonSerializable()
class PayoutConfirm {
  const PayoutConfirm({
    required this.outcome,
    this.externalReference,
    this.failureReason,
  });

  factory PayoutConfirm.fromJson(Map<String, Object?> json) =>
      _$PayoutConfirmFromJson(json);

  final PayoutConfirmOutcome outcome;
  @JsonKey(name: 'external_reference')
  final String? externalReference;
  @JsonKey(name: 'failure_reason')
  final String? failureReason;

  Map<String, Object?> toJson() => _$PayoutConfirmToJson(this);
}
