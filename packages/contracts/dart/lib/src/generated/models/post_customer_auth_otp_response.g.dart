// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_customer_auth_otp_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostCustomerAuthOtpResponse _$PostCustomerAuthOtpResponseFromJson(
  Map<String, dynamic> json,
) => PostCustomerAuthOtpResponse(
  otpRequestId: json['otp_request_id'] as String,
  expiresIn: (json['expires_in'] as num).toInt(),
);

Map<String, dynamic> _$PostCustomerAuthOtpResponseToJson(
  PostCustomerAuthOtpResponse instance,
) => <String, dynamic>{
  'otp_request_id': instance.otpRequestId,
  'expires_in': instance.expiresIn,
};
