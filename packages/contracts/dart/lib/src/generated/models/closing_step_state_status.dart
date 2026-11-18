// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// `TODO` : aucune ligne `closing_step` ; `DONE` : écritures faites ; `NOT_APPLICABLE` : sans objet.
@JsonEnum()
enum ClosingStepStateStatus {
  @JsonValue('TODO')
  todo('TODO'),
  @JsonValue('DONE')
  done('DONE'),
  @JsonValue('NOT_APPLICABLE')
  notApplicable('NOT_APPLICABLE');

  const ClosingStepStateStatus(this.json);

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
