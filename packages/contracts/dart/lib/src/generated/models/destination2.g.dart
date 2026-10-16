// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'destination2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Destination2 _$Destination2FromJson(Map<String, dynamic> json) => Destination2(
  method: $enumDecode(_$Method2EnumMap, json['method']),
  msisdn: json['msisdn'] as String?,
  newNumberOtp: json['new_number_otp'] == null
      ? null
      : NewNumberOtp.fromJson(json['new_number_otp'] as Map<String, dynamic>),
  iban: json['iban'] as String?,
);

Map<String, dynamic> _$Destination2ToJson(Destination2 instance) =>
    <String, dynamic>{
      'method': instance.method,
      'msisdn': instance.msisdn,
      'new_number_otp': instance.newNumberOtp,
      'iban': instance.iban,
    };

const _$Method2EnumMap = {
  Method2.wave: 'WAVE',
  Method2.orangeMoney: 'ORANGE_MONEY',
  Method2.bankTransfer: 'BANK_TRANSFER',
};
