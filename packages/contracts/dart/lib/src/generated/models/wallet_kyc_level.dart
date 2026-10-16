// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Calculé à la lecture (ADR-54) — VERIFIED tant que le client a une identification non révoquée et une pièce non expirée.
@JsonEnum()
enum WalletKycLevel {
  @JsonValue('NONE')
  none('NONE'),
  @JsonValue('VERIFIED')
  verified('VERIFIED');

  const WalletKycLevel(this.json);

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
