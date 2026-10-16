// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'party_update.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PartyUpdate _$PartyUpdateFromJson(Map<String, dynamic> json) => PartyUpdate(
  legalName: json['legal_name'] as String?,
  countryCode: json['country_code'] as String?,
  taxId: json['tax_id'] as String?,
);

Map<String, dynamic> _$PartyUpdateToJson(PartyUpdate instance) =>
    <String, dynamic>{
      'legal_name': instance.legalName,
      'country_code': instance.countryCode,
      'tax_id': instance.taxId,
    };
