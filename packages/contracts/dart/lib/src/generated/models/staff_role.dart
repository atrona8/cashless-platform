// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Rôles du personnel (SPECIFICATION §3.2). `VENDOR` et `CUSTOMER` existent mais ne sont pas attribuables par.
/// `grantRole` dans cette version.
///
@JsonEnum()
enum StaffRole {
  @JsonValue('PLATFORM_ADMIN')
  platformAdmin('PLATFORM_ADMIN'),
  @JsonValue('OPERATOR_ADMIN')
  operatorAdmin('OPERATOR_ADMIN'),
  @JsonValue('ORGANIZER_ADMIN')
  organizerAdmin('ORGANIZER_ADMIN'),
  @JsonValue('SUPERVISOR')
  supervisor('SUPERVISOR'),
  @JsonValue('CASHIER')
  cashier('CASHIER'),
  @JsonValue('MERCHANT_ADMIN')
  merchantAdmin('MERCHANT_ADMIN'),
  @JsonValue('VENDOR')
  vendor('VENDOR'),
  @JsonValue('CUSTOMER')
  customer('CUSTOMER'),
  @JsonValue('PERSONALIZER')
  personalizer('PERSONALIZER');

  const StaffRole(this.json);

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
