// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum MediaStatus {
  @JsonValue('PERSONALIZED')
  personalized('PERSONALIZED'),
  @JsonValue('ISSUED')
  issued('ISSUED'),
  @JsonValue('ACTIVE')
  active('ACTIVE'),
  @JsonValue('SUSPENDED')
  suspended('SUSPENDED'),
  @JsonValue('REPLACED')
  replaced('REPLACED'),
  @JsonValue('BLACKLISTED')
  blacklisted('BLACKLISTED'),
  @JsonValue('RELEASED')
  released('RELEASED'),
  @JsonValue('RETIRED')
  retired('RETIRED'),
  @JsonValue('DESTROYED')
  destroyed('DESTROYED');

  const MediaStatus(this.json);

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
