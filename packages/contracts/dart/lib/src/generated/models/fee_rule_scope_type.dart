// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Portée d'une règle de frais (§5.6) : `PLATFORM_CONTRACT` (plateforme → prestataire), `OPERATOR_CONTRACT`.
/// (prestataire → organisateur), `EVENT` et `PARTICIPATION` (organisateur → commerçant, frais festivalier).
///
@JsonEnum()
enum FeeRuleScopeType {
  @JsonValue('PLATFORM_CONTRACT')
  platformContract('PLATFORM_CONTRACT'),
  @JsonValue('OPERATOR_CONTRACT')
  operatorContract('OPERATOR_CONTRACT'),
  @JsonValue('EVENT')
  event('EVENT'),
  @JsonValue('PARTICIPATION')
  participation('PARTICIPATION');

  const FeeRuleScopeType(this.json);

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
