// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// `ACTIVE` : personnalise de nouveaux bracelets ; `DECRYPT_ONLY` : ne sert plus qu'à lire les bracelets existants ; `RETIRED` : clé retirée.
@JsonEnum()
enum TagKeyStatus {
  @JsonValue('ACTIVE')
  active('ACTIVE'),
  @JsonValue('DECRYPT_ONLY')
  decryptOnly('DECRYPT_ONLY'),
  @JsonValue('RETIRED')
  retired('RETIRED');

  const TagKeyStatus(this.json);

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
