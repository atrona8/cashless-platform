// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'device_enrollment_response.g.dart';

@JsonSerializable()
class DeviceEnrollmentResponse {
  const DeviceEnrollmentResponse({
    required this.deviceId,
    required this.serial,
    required this.certificatePem,
    required this.accessToken,
    required this.tokenType,
    required this.expiresIn,
    required this.refreshToken,
    required this.nextSeq,
    required this.serverTime,
  });

  factory DeviceEnrollmentResponse.fromJson(Map<String, Object?> json) =>
      _$DeviceEnrollmentResponseFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final String serial;

  /// Certificat client X.509 (PEM) émis par l'autorité des terminaux, à présenter en mTLS.
  @JsonKey(name: 'certificate_pem')
  final String certificatePem;
  @JsonKey(name: 'access_token')
  final String accessToken;
  @JsonKey(name: 'token_type')
  final String tokenType;
  @JsonKey(name: 'expires_in')
  final int expiresIn;
  @JsonKey(name: 'refresh_token')
  final String refreshToken;
  @JsonKey(name: 'next_seq')
  final int nextSeq;
  @JsonKey(name: 'server_time')
  final Timestamp serverTime;

  Map<String, Object?> toJson() => _$DeviceEnrollmentResponseToJson(this);
}
