// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_token_refresh_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceTokenRefreshRequest _$DeviceTokenRefreshRequestFromJson(
  Map<String, dynamic> json,
) => DeviceTokenRefreshRequest(
  serial: json['serial'] as String,
  refreshToken: json['refresh_token'] as String,
  nonce: json['nonce'] as String,
  signature: json['signature'] as String,
);

Map<String, dynamic> _$DeviceTokenRefreshRequestToJson(
  DeviceTokenRefreshRequest instance,
) => <String, dynamic>{
  'serial': instance.serial,
  'refresh_token': instance.refreshToken,
  'nonce': instance.nonce,
  'signature': instance.signature,
};
