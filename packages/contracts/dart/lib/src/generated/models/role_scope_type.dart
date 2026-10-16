// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Portée d'une attribution. Englobement : `PLATFORM` ⊃ `OPERATOR` ⊃ `ORGANIZER` ⊃ `EVENT` ; `OPERATOR` ⊃.
/// `MERCHANT` ; un événement englobe les commerçants qui y participent.
///
@JsonEnum()
enum RoleScopeType {
  @JsonValue('PLATFORM')
  platform('PLATFORM'),

  /// The name has been replaced because it contains a keyword. Original name: `OPERATOR`.
  @JsonValue('OPERATOR')
  valueOperator('OPERATOR'),
  @JsonValue('ORGANIZER')
  organizer('ORGANIZER'),
  @JsonValue('EVENT')
  event('EVENT'),
  @JsonValue('MERCHANT')
  merchant('MERCHANT');

  const RoleScopeType(this.json);

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
