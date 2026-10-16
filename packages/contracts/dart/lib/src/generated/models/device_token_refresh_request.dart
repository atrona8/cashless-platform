// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'device_token_refresh_request.g.dart';

@JsonSerializable()
class DeviceTokenRefreshRequest {
  const DeviceTokenRefreshRequest({
    required this.serial,
    required this.refreshToken,
    required this.nonce,
    required this.signature,
  });

  factory DeviceTokenRefreshRequest.fromJson(Map<String, Object?> json) =>
      _$DeviceTokenRefreshRequestFromJson(json);

  final String serial;
  @JsonKey(name: 'refresh_token')
  final String refreshToken;
  final String nonce;
  final String signature;

  Map<String, Object?> toJson() => _$DeviceTokenRefreshRequestToJson(this);
}
