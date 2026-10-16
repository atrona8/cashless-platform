// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum Status {
  @JsonValue('DRAFT')
  draft('DRAFT'),
  @JsonValue('LIVE')
  live('LIVE'),
  @JsonValue('CLOSING')
  closing('CLOSING'),
  @JsonValue('RECONCILING')
  reconciling('RECONCILING'),
  @JsonValue('SETTLING')
  settling('SETTLING'),
  @JsonValue('REFUND_WINDOW')
  refundWindow('REFUND_WINDOW'),
  @JsonValue('CLOSED')
  closed('CLOSED');

  const Status(this.json);

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
