// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum FeeRuleCreateBasis {
  @JsonValue('TOPUP_AMOUNT')
  topupAmount('TOPUP_AMOUNT'),
  @JsonValue('SALE_AMOUNT')
  saleAmount('SALE_AMOUNT'),
  @JsonValue('PER_MEDIA')
  perMedia('PER_MEDIA'),
  @JsonValue('PER_TERMINAL_DAY')
  perTerminalDay('PER_TERMINAL_DAY'),
  @JsonValue('PER_REFUND')
  perRefund('PER_REFUND'),
  @JsonValue('FIXED')
  fixed('FIXED'),
  @JsonValue('FEE_AMOUNT')
  feeAmount('FEE_AMOUNT');

  const FeeRuleCreateBasis(this.json);

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
