// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Traitement manuel en V1 : `REQUESTED` → `PROCESSING` (approuvée par une seconde personne,.
/// `WALLET_REFUND` écrite, paiement hors système en cours) → `PAID` (confirmé) ou `FAILED` (échec.
/// enregistré, `WALLET_REFUND` contre-passée). `REQUESTED` → `REJECTED` (refus du back-office).
/// `CANCELLED` : demande retirée avant approbation.
/// Autre numéro (ADR-76) : `AWAITING_HOLDER` (le titulaire a reçu un code ; confirmation, blocage, ou passage.
/// automatique à `REQUESTED` à `hold_until`) ; `BLOCKED` (bloquée par le titulaire, finale).
///
@JsonEnum()
enum RefundRequestStatus {
  @JsonValue('AWAITING_HOLDER')
  awaitingHolder('AWAITING_HOLDER'),
  @JsonValue('REQUESTED')
  requested('REQUESTED'),
  @JsonValue('PROCESSING')
  processing('PROCESSING'),
  @JsonValue('PAID')
  paid('PAID'),
  @JsonValue('FAILED')
  failed('FAILED'),
  @JsonValue('REJECTED')
  rejected('REJECTED'),
  @JsonValue('CANCELLED')
  cancelled('CANCELLED'),
  @JsonValue('BLOCKED')
  blocked('BLOCKED');

  const RefundRequestStatus(this.json);

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
