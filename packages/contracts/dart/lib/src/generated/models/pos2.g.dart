// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pos2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Pos2 _$Pos2FromJson(Map<String, dynamic> json) => Pos2(
  posId: json['pos_id'] as String,
  name: json['name'] as String,
  merchantName: json['merchant_name'] as String,
);

Map<String, dynamic> _$Pos2ToJson(Pos2 instance) => <String, dynamic>{
  'pos_id': instance.posId,
  'name': instance.name,
  'merchant_name': instance.merchantName,
};
