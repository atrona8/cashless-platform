// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Moyen de paiement choisi par le payeur (ADR-70). WAVE et ORANGE_MONEY : intégrations directes. CARD :.
/// traité par le PSP carte que le prestataire a configuré pour l'organisateur (agrégateur local comme.
/// PayDunya, ou PSP international comme Stripe) ; refusé (`422 VALIDATION_FAILED`) si l'organisateur n'a.
/// aucun PSP carte actif.
///
@JsonEnum()
enum PspProvider {
  @JsonValue('WAVE')
  wave('WAVE'),
  @JsonValue('ORANGE_MONEY')
  orangeMoney('ORANGE_MONEY'),
  @JsonValue('CARD')
  card('CARD');

  const PspProvider(this.json);

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
