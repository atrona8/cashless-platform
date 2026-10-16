// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'operator_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OperatorCreate _$OperatorCreateFromJson(Map<String, dynamic> json) =>
    OperatorCreate(
      legalName: json['legal_name'] as String,
      countryCode: json['country_code'] as String,
      taxId: json['tax_id'] as String?,
    );

Map<String, dynamic> _$OperatorCreateToJson(OperatorCreate instance) =>
    <String, dynamic>{
      'legal_name': instance.legalName,
      'country_code': instance.countryCode,
      'tax_id': instance.taxId,
    };
