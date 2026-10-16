// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'destination.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Destination _$DestinationFromJson(Map<String, dynamic> json) => Destination(
  method: $enumDecode(_$MethodEnumMap, json['method']),
  msisdn: json['msisdn'] as String?,
  iban: json['iban'] as String?,
);

Map<String, dynamic> _$DestinationToJson(Destination instance) =>
    <String, dynamic>{
      'method': instance.method,
      'msisdn': instance.msisdn,
      'iban': instance.iban,
    };

const _$MethodEnumMap = {
  Method.cash: 'CASH',
  Method.wave: 'WAVE',
  Method.orangeMoney: 'ORANGE_MONEY',
  Method.bankTransfer: 'BANK_TRANSFER',
};
