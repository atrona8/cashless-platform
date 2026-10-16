// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// `ECDSA_P256_SHA256` par défaut ; Ed25519 si le KMS le permet (POINTS_OUVERTS OP-N13).
@JsonEnum()
enum Algorithm {
  @JsonValue('ECDSA_P256_SHA256')
  ecdsaP256Sha256('ECDSA_P256_SHA256'),
  @JsonValue('Ed25519')
  ed25519('Ed25519');

  const Algorithm(this.json);

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
