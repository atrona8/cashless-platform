// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'new_number_otp.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

NewNumberOtp _$NewNumberOtpFromJson(Map<String, dynamic> json) => NewNumberOtp(
  otpRequestId: json['otp_request_id'] as String,
  code: json['code'] as String,
);

Map<String, dynamic> _$NewNumberOtpToJson(NewNumberOtp instance) =>
    <String, dynamic>{
      'otp_request_id': instance.otpRequestId,
      'code': instance.code,
    };
