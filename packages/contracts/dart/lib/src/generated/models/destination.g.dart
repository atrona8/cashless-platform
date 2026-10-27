// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'destination.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Destination _$DestinationFromJson(Map<String, dynamic> json) => Destination(
  method: $enumDecode(_$Method2EnumMap, json['method']),
  msisdn: json['msisdn'] as String?,
  iban: json['iban'] as String?,
);

Map<String, dynamic> _$DestinationToJson(Destination instance) =>
    <String, dynamic>{
      'method': instance.method,
      'msisdn': instance.msisdn,
      'iban': instance.iban,
    };

const _$Method2EnumMap = {
  Method2.cash: 'CASH',
  Method2.wave: 'WAVE',
  Method2.orangeMoney: 'ORANGE_MONEY',
  Method2.bankTransfer: 'BANK_TRANSFER',
};
