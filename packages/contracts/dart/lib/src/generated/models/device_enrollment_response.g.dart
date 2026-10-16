// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_enrollment_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceEnrollmentResponse _$DeviceEnrollmentResponseFromJson(
  Map<String, dynamic> json,
) => DeviceEnrollmentResponse(
  deviceId: json['device_id'] as String,
  serial: json['serial'] as String,
  accessToken: json['access_token'] as String,
  tokenType: json['token_type'] as String,
  expiresIn: (json['expires_in'] as num).toInt(),
  refreshToken: json['refresh_token'] as String,
  nextSeq: (json['next_seq'] as num).toInt(),
  serverTime: DateTime.parse(json['server_time'] as String),
  certificatePem: json['certificate_pem'] as String?,
);

Map<String, dynamic> _$DeviceEnrollmentResponseToJson(
  DeviceEnrollmentResponse instance,
) => <String, dynamic>{
  'device_id': instance.deviceId,
  'serial': instance.serial,
  'certificate_pem': instance.certificatePem,
  'access_token': instance.accessToken,
  'token_type': instance.tokenType,
  'expires_in': instance.expiresIn,
  'refresh_token': instance.refreshToken,
  'next_seq': instance.nextSeq,
  'server_time': instance.serverTime.toIso8601String(),
};
