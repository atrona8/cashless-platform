// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_enrollment_request_os.dart';

part 'device_enrollment_request.g.dart';

@JsonSerializable()
class DeviceEnrollmentRequest {
  const DeviceEnrollmentRequest({
    required this.enrollmentCode,
    required this.serial,
    required this.os,
    required this.appVersion,
    required this.signingPublicKey,
    required this.agreementPublicKey,
    required this.keyAttestationChain,
    this.csrPem,
  });

  factory DeviceEnrollmentRequest.fromJson(Map<String, Object?> json) =>
      _$DeviceEnrollmentRequestFromJson(json);

  @JsonKey(name: 'enrollment_code')
  final String enrollmentCode;

  /// Numéro de série logique du terminal (préfixe des clés d'idempotence).
  final String serial;
  final DeviceEnrollmentRequestOs os;
  @JsonKey(name: 'app_version')
  final String appVersion;

  /// Clé publique ECDSA P-256 (SubjectPublicKeyInfo DER) → `device.public_key`.
  @JsonKey(name: 'signing_public_key')
  final String signingPublicKey;

  /// Clé publique ECDH P-256 (SPKI DER) pour le chiffrement des PWD/PACK.
  @JsonKey(name: 'agreement_public_key')
  final String agreementPublicKey;

  /// Chaîne d'attestation Android Key Attestation (iOS : App Attest).
  @JsonKey(name: 'key_attestation_chain')
  final List<String> keyAttestationChain;

  /// CSR PKCS#10 signé par la clé de signature (pour obtenir un certificat mTLS).
  @JsonKey(name: 'csr_pem')
  final String? csrPem;

  Map<String, Object?> toJson() => _$DeviceEnrollmentRequestToJson(this);
}
