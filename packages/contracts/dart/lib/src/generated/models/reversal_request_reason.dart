// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum ReversalRequestReason {
  @JsonValue('INPUT_ERROR')
  inputError('INPUT_ERROR'),
  @JsonValue('CUSTOMER_CANCELLED')
  customerCancelled('CUSTOMER_CANCELLED'),
  @JsonValue('PRODUCT_UNAVAILABLE')
  productUnavailable('PRODUCT_UNAVAILABLE'),
  @JsonValue('DUPLICATE')
  duplicate('DUPLICATE'),
  @JsonValue('OTHER')
  other('OTHER');

  const ReversalRequestReason(this.json);

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
