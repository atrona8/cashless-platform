// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_policy.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CatalogPolicy _$CatalogPolicyFromJson(Map<String, dynamic> json) =>
    CatalogPolicy(
      merchantManages: json['merchant_manages'] as bool,
      posId: json['pos_id'] as String?,
    );

Map<String, dynamic> _$CatalogPolicyToJson(CatalogPolicy instance) =>
    <String, dynamic>{
      'pos_id': instance.posId,
      'merchant_manages': instance.merchantManages,
    };
