// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'customer_auth_otp_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CustomerAuthOtpRequestBody _$CustomerAuthOtpRequestBodyFromJson(
  Map<String, dynamic> json,
) => CustomerAuthOtpRequestBody(
  phone: json['phone'] as String,
  operatorCode: json['operator_code'] as String,
  channel:
      $enumDecodeNullable(_$ChannelEnumMap, json['channel']) ?? Channel.auto,
);

Map<String, dynamic> _$CustomerAuthOtpRequestBodyToJson(
  CustomerAuthOtpRequestBody instance,
) => <String, dynamic>{
  'phone': instance.phone,
  'operator_code': instance.operatorCode,
  'channel': instance.channel,
};

const _$ChannelEnumMap = {
  Channel.auto: 'AUTO',
  Channel.sms: 'SMS',
  Channel.whatsapp: 'WHATSAPP',
};
