// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'operator.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Operator _$OperatorFromJson(Map<String, dynamic> json) => Operator(
  operatorId: json['operator_id'] as String,
  legalName: json['legal_name'] as String,
  countryCode: json['country_code'] as String?,
  taxId: json['tax_id'] as String?,
  createdAt: DateTime.parse(json['created_at'] as String),
);

Map<String, dynamic> _$OperatorToJson(Operator instance) => <String, dynamic>{
  'operator_id': instance.operatorId,
  'legal_name': instance.legalName,
  'country_code': instance.countryCode,
  'tax_id': instance.taxId,
  'created_at': instance.createdAt.toIso8601String(),
};
