// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'party_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PartyCreate _$PartyCreateFromJson(Map<String, dynamic> json) => PartyCreate(
  legalName: json['legal_name'] as String,
  countryCode: json['country_code'] as String?,
  taxId: json['tax_id'] as String?,
);

Map<String, dynamic> _$PartyCreateToJson(PartyCreate instance) =>
    <String, dynamic>{
      'legal_name': instance.legalName,
      'country_code': instance.countryCode,
      'tax_id': instance.taxId,
    };
