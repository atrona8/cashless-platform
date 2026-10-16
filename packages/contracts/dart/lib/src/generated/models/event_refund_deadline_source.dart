// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// `PROVISIONAL_DEFAULT` : fin + 30 jours (§17.2), à confirmer.
@JsonEnum()
enum EventRefundDeadlineSource {
  @JsonValue('EXPLICIT')
  explicit('EXPLICIT'),
  @JsonValue('PROVISIONAL_DEFAULT')
  provisionalDefault('PROVISIONAL_DEFAULT'),

  /// The name has been replaced because it contains a keyword. Original name: `null`.
  @JsonValue(null)
  valueNull(null);

  const EventRefundDeadlineSource(this.json);

  final String? json;
  String? toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String?. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String?;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
