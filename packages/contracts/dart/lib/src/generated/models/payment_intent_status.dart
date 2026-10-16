// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum PaymentIntentStatus {
  @JsonValue('REQUIRES_PAYMENT')
  requiresPayment('REQUIRES_PAYMENT'),
  @JsonValue('AUTHORIZED')
  authorized('AUTHORIZED'),
  @JsonValue('SUCCEEDED')
  succeeded('SUCCEEDED'),
  @JsonValue('CANCELLED')
  cancelled('CANCELLED'),
  @JsonValue('EXPIRED')
  expired('EXPIRED'),
  @JsonValue('FAILED')
  failed('FAILED');

  const PaymentIntentStatus(this.json);

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
