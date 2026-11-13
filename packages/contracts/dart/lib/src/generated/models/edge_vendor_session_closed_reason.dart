// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum EdgeVendorSessionClosedReason {
  @JsonValue('LOGOUT')
  logout('LOGOUT'),
  @JsonValue('REPLACED')
  replaced('REPLACED'),
  @JsonValue('VENDOR_DISABLED')
  vendorDisabled('VENDOR_DISABLED'),
  @JsonValue('VENDOR_LOCKED')
  vendorLocked('VENDOR_LOCKED'),
  @JsonValue('DEVICE_SUSPENDED')
  deviceSuspended('DEVICE_SUSPENDED'),
  @JsonValue('DEVICE_REVOKED')
  deviceRevoked('DEVICE_REVOKED'),
  @JsonValue('PIN_CHANGED')
  pinChanged('PIN_CHANGED');

  const EdgeVendorSessionClosedReason(this.json);

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
