// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum StaffAssignmentRole {
  @JsonValue('PLATFORM_ADMIN')
  platformAdmin('PLATFORM_ADMIN'),
  @JsonValue('OPERATOR_ADMIN')
  operatorAdmin('OPERATOR_ADMIN'),
  @JsonValue('ORGANIZER_ADMIN')
  organizerAdmin('ORGANIZER_ADMIN'),
  @JsonValue('MERCHANT_ADMIN')
  merchantAdmin('MERCHANT_ADMIN'),
  @JsonValue('SUPERVISOR')
  supervisor('SUPERVISOR'),
  @JsonValue('CASHIER')
  cashier('CASHIER'),
  @JsonValue('PERSONALIZER')
  personalizer('PERSONALIZER');

  const StaffAssignmentRole(this.json);

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
