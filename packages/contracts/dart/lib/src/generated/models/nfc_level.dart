// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Niveau NFC d'un modèle de téléphone ; `UNTESTED` si le modèle n'est pas dans la table.
@JsonEnum()
enum NfcLevel {
  @JsonValue('RECOMMENDED')
  recommended('RECOMMENDED'),
  @JsonValue('TOLERATED')
  tolerated('TOLERATED'),
  @JsonValue('UNTESTED')
  untested('UNTESTED');

  const NfcLevel(this.json);

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
