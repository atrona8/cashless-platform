// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pos.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Pos _$PosFromJson(Map<String, dynamic> json) => Pos(
  posId: json['pos_id'] as String?,
  name: json['name'] as String?,
  merchantName: json['merchant_name'] as String?,
);

Map<String, dynamic> _$PosToJson(Pos instance) => <String, dynamic>{
  'pos_id': instance.posId,
  'name': instance.name,
  'merchant_name': instance.merchantName,
};
