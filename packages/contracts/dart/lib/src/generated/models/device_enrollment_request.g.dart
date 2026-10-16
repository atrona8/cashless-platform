// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_enrollment_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceEnrollmentRequest _$DeviceEnrollmentRequestFromJson(
  Map<String, dynamic> json,
) => DeviceEnrollmentRequest(
  enrollmentCode: json['enrollment_code'] as String,
  serial: json['serial'] as String,
  os: $enumDecode(_$DeviceEnrollmentRequestOsEnumMap, json['os']),
  appVersion: json['app_version'] as String,
  signingPublicKey: json['signing_public_key'] as String,
  agreementPublicKey: json['agreement_public_key'] as String,
  keyAttestationChain: (json['key_attestation_chain'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
  csrPem: json['csr_pem'] as String?,
);

Map<String, dynamic> _$DeviceEnrollmentRequestToJson(
  DeviceEnrollmentRequest instance,
) => <String, dynamic>{
  'enrollment_code': instance.enrollmentCode,
  'serial': instance.serial,
  'os': instance.os,
  'app_version': instance.appVersion,
  'signing_public_key': instance.signingPublicKey,
  'agreement_public_key': instance.agreementPublicKey,
  'key_attestation_chain': instance.keyAttestationChain,
  'csr_pem': instance.csrPem,
};

const _$DeviceEnrollmentRequestOsEnumMap = {
  DeviceEnrollmentRequestOs.android: 'ANDROID',
  DeviceEnrollmentRequestOs.ios: 'IOS',
};
