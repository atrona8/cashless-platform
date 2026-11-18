// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'destination4.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Destination4 _$Destination4FromJson(Map<String, dynamic> json) => Destination4(
  method: $enumDecode(_$Method3EnumMap, json['method']),
  msisdn: json['msisdn'] as String?,
  iban: json['iban'] as String?,
);

Map<String, dynamic> _$Destination4ToJson(Destination4 instance) =>
    <String, dynamic>{
      'method': instance.method,
      'msisdn': instance.msisdn,
      'iban': instance.iban,
    };

const _$Method3EnumMap = {
  Method3.wave: 'WAVE',
  Method3.orangeMoney: 'ORANGE_MONEY',
  Method3.bankTransfer: 'BANK_TRANSFER',
};
