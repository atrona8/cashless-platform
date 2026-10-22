// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum DeviceEnrollmentCodeSummaryAppMode {
  @JsonValue('CATALOG_POS')
  catalogPos('CATALOG_POS'),
  @JsonValue('KEYPAD_TPE')
  keypadTpe('KEYPAD_TPE'),
  @JsonValue('TOPUP_DESK')
  topupDesk('TOPUP_DESK'),

  /// The name has been replaced because it contains a keyword. Original name: `null`.
  @JsonValue(null)
  valueNull(null);

  const DeviceEnrollmentCodeSummaryAppMode(this.json);

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
