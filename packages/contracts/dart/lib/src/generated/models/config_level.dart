// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Niveau de la cascade de configuration (§4.2), du plus général au plus précis.
@JsonEnum()
enum ConfigLevel {
  @JsonValue('PLATFORM')
  platform('PLATFORM'),

  /// The name has been replaced because it contains a keyword. Original name: `OPERATOR`.
  @JsonValue('OPERATOR')
  valueOperator('OPERATOR'),
  @JsonValue('ORGANIZER')
  organizer('ORGANIZER'),
  @JsonValue('EVENT')
  event('EVENT'),
  @JsonValue('PARTICIPATION')
  participation('PARTICIPATION');

  const ConfigLevel(this.json);

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
