// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Mode d'application du terminal. `PAIRED_TPE` (TPE associé à une caisse tierce) est **V2 (ADR-43)** :.
/// valeur conservée pour la compatibilité future, mais toute création de code d'enrôlement ou tout.
/// enrôlement avec cette valeur est refusé en V1 (`422 DEVICE_MODE_NOT_ALLOWED`) ; la base ne l'accepte pas.
///
@JsonEnum()
enum DeviceAppMode {
  @JsonValue('CATALOG_POS')
  catalogPos('CATALOG_POS'),
  @JsonValue('KEYPAD_TPE')
  keypadTpe('KEYPAD_TPE'),
  @JsonValue('TOPUP_DESK')
  topupDesk('TOPUP_DESK'),
  @JsonValue('PAIRED_TPE')
  pairedTpe('PAIRED_TPE');

  const DeviceAppMode(this.json);

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
