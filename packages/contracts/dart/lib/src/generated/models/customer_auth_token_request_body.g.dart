// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'customer_auth_token_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CustomerAuthTokenRequestBody _$CustomerAuthTokenRequestBodyFromJson(
  Map<String, dynamic> json,
) => CustomerAuthTokenRequestBody(
  otpRequestId: json['otp_request_id'] as String,
  code: json['code'] as String,
);

Map<String, dynamic> _$CustomerAuthTokenRequestBodyToJson(
  CustomerAuthTokenRequestBody instance,
) => <String, dynamic>{
  'otp_request_id': instance.otpRequestId,
  'code': instance.code,
};
