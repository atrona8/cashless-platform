// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'merchant.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Merchant _$MerchantFromJson(Map<String, dynamic> json) => Merchant(
  merchantId: json['merchant_id'] as String,
  operatorId: json['operator_id'] as String,
  legalName: json['legal_name'] as String,
  countryCode: json['country_code'] as String?,
  taxId: json['tax_id'] as String?,
  createdAt: DateTime.parse(json['created_at'] as String),
);

Map<String, dynamic> _$MerchantToJson(Merchant instance) => <String, dynamic>{
  'merchant_id': instance.merchantId,
  'operator_id': instance.operatorId,
  'legal_name': instance.legalName,
  'country_code': instance.countryCode,
  'tax_id': instance.taxId,
  'created_at': instance.createdAt.toIso8601String(),
};
