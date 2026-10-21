// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_enrollment_request_os.dart';

part 'device_enrollment_request.g.dart';

/// Demande d'enrôlement. Le code est scanné AVANT la génération des clés : les défis d'attestation en dérivent.
/// (voir `enrollDevice`). Android : version 12 au moins, deux chaînes d'attestation (une par clé), défis.
/// `A` (clé d'accord) et `S` (clé de signature). iOS : objet App Attest dans `key_attestation_chain`, défi.
/// `clientDataHash` qui lie le code, le `serial` et les deux clés publiques.
///
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
    required this.csrPem,
    this.agreementAttestationChain,
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

  /// Clé publique ECDSA P-256 : SubjectPublicKeyInfo DER canonique (point non compressé, 91 octets) →.
  /// `device.public_key`. Le serveur réencode la clé et exige les mêmes octets ; les défis hachent ces.
  /// octets tels quels.
  ///
  @JsonKey(name: 'signing_public_key')
  final String signingPublicKey;

  /// Clé publique ECDH P-256 pour le chiffrement des PWD/PACK : SubjectPublicKeyInfo DER canonique (point.
  /// non compressé, 91 octets), même forme sur Android et iOS. Le serveur réencode la clé et exige les.
  /// mêmes octets ; les défis `S` (Android) et `clientDataHash` (iOS) hachent ces octets tels quels. Le.
  /// serveur garde le point non compressé de 65 octets qu'ils contiennent (`device.agreement_public_key`).
  ///
  @JsonKey(name: 'agreement_public_key')
  final String agreementPublicKey;

  /// Android : chaîne d'attestation de clé (KeyMint) de la clé de signature, feuille en tête, générée avec le.
  /// défi `S`. iOS : objet d'attestation App Attest (défi `clientDataHash`).
  ///
  @JsonKey(name: 'key_attestation_chain')
  final List<String> keyAttestationChain;

  /// Android (obligatoire quand `os = ANDROID`) : chaîne d'attestation de clé (KeyMint) de la clé d'accord,.
  /// feuille en tête, générée avec le défi `A`. iOS : absent (la clé d'accord est liée par.
  /// `clientDataHash`).
  ///
  @JsonKey(name: 'agreement_attestation_chain')
  final List<String>? agreementAttestationChain;

  /// CSR PKCS#10 (PEM) signé par la clé de signature, dont la clé publique est `signing_public_key` ; sinon.
  /// `422 ATTESTATION_FAILED`. Obligatoire : le certificat client (mTLS) est l'une des trois preuves.
  ///
  @JsonKey(name: 'csr_pem')
  final String csrPem;

  Map<String, Object?> toJson() => _$DeviceEnrollmentRequestToJson(this);
}
