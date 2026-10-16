// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Titulaire des comptes d'argent de l'événement (§4.4). Obligatoire, sans valeur par défaut, hors cascade.
@JsonEnum()
enum FundsHolder {
  @JsonValue('ORGANIZER')
  organizer('ORGANIZER'),

  /// The name has been replaced because it contains a keyword. Original name: `OPERATOR`.
  @JsonValue('OPERATOR')
  valueOperator('OPERATOR'),
  @JsonValue('THIRD_PARTY')
  thirdParty('THIRD_PARTY');

  const FundsHolder(this.json);

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
