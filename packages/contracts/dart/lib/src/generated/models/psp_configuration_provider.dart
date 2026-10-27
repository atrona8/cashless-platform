// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Fournisseur d'une configuration PSP (`psp_configuration.provider`) : `WAVE` et `ORANGE_MONEY`.
/// (intégrations directes), `PAYDUNYA` (agrégateur local) et `STRIPE` (PSP international) pour la carte.
/// Ne pas confondre avec `PspProvider`, qui porte le MOYEN de paiement (`WAVE`, `ORANGE_MONEY`, `CARD`).
///
@JsonEnum()
enum PspConfigurationProvider {
  @JsonValue('WAVE')
  wave('WAVE'),
  @JsonValue('ORANGE_MONEY')
  orangeMoney('ORANGE_MONEY'),
  @JsonValue('PAYDUNYA')
  paydunya('PAYDUNYA'),
  @JsonValue('STRIPE')
  stripe('STRIPE');

  const PspConfigurationProvider(this.json);

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
