// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Preuve d'attestation vérifiée à l'enrôlement (`null` pour un terminal antérieur à la mission).
@JsonEnum()
enum DeviceAdminAttestationKind {
  @JsonValue('ANDROID_KEY_ATTESTATION')
  androidKeyAttestation('ANDROID_KEY_ATTESTATION'),
  @JsonValue('IOS_APP_ATTEST')
  iosAppAttest('IOS_APP_ATTEST'),

  /// The name has been replaced because it contains a keyword. Original name: `null`.
  @JsonValue(null)
  valueNull(null);

  const DeviceAdminAttestationKind(this.json);

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
