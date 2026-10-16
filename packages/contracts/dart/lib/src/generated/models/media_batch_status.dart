// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Statut d'un lot (§7.7). Seul un lot `ACTIVE` paie.
@JsonEnum()
enum MediaBatchStatus {
  @JsonValue('ORDERED')
  ordered('ORDERED'),
  @JsonValue('PERSONALIZED')
  personalized('PERSONALIZED'),
  @JsonValue('DELIVERED')
  delivered('DELIVERED'),
  @JsonValue('ACTIVE')
  active('ACTIVE'),
  @JsonValue('SUSPENDED')
  suspended('SUSPENDED'),
  @JsonValue('CLOSED')
  closed('CLOSED');

  const MediaBatchStatus(this.json);

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
