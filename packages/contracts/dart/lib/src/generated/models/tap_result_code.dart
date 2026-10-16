// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Résultat de `register_tap` (champ `result`). `SIGNATURE_MISSING` n'existe qu'en ligne : hors ligne, une.
/// signature absente ouvre une anomalie `SIGNATURE_MISMATCH` et l'opération est gardée.
///
@JsonEnum()
enum TapResultCode {
  @JsonValue('OK')
  ok('OK'),
  @JsonValue('UNKNOWN')
  unknown('UNKNOWN'),
  @JsonValue('BLOCKED')
  blocked('BLOCKED'),
  @JsonValue('UID_MISMATCH')
  uidMismatch('UID_MISMATCH'),
  @JsonValue('SIGNATURE_MISMATCH')
  signatureMismatch('SIGNATURE_MISMATCH'),
  @JsonValue('SIGNATURE_MISSING')
  signatureMissing('SIGNATURE_MISSING'),
  @JsonValue('CLONE_SUSPECTED')
  cloneSuspected('CLONE_SUSPECTED'),
  @JsonValue('RETIRED')
  retired('RETIRED'),
  @JsonValue('REPLACED')
  replaced('REPLACED'),
  @JsonValue('NOT_ACTIVATED')
  notActivated('NOT_ACTIVATED'),
  @JsonValue('RELEASED')
  released('RELEASED'),
  @JsonValue('BATCH_INACTIVE')
  batchInactive('BATCH_INACTIVE'),
  @JsonValue('WRONG_EVENT')
  wrongEvent('WRONG_EVENT');

  const TapResultCode(this.json);

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
