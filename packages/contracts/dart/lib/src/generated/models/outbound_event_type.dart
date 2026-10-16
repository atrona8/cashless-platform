// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum OutboundEventType {
  /// Incorrect name has been replaced. Original name: `payment_intent.authorized`.
  @JsonValue('payment_intent.authorized')
  undefined0('payment_intent.authorized'),

  /// Incorrect name has been replaced. Original name: `payment_intent.succeeded`.
  @JsonValue('payment_intent.succeeded')
  undefined1('payment_intent.succeeded'),

  /// Incorrect name has been replaced. Original name: `payment_intent.cancelled`.
  @JsonValue('payment_intent.cancelled')
  undefined2('payment_intent.cancelled'),

  /// Incorrect name has been replaced. Original name: `payment_intent.expired`.
  @JsonValue('payment_intent.expired')
  undefined3('payment_intent.expired'),

  /// Incorrect name has been replaced. Original name: `payment_intent.failed`.
  @JsonValue('payment_intent.failed')
  undefined4('payment_intent.failed'),

  /// Incorrect name has been replaced. Original name: `payment_intent.reversed`.
  @JsonValue('payment_intent.reversed')
  undefined5('payment_intent.reversed');

  const OutboundEventType(this.json);

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
