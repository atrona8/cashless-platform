// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'point_of_sale.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PointOfSale _$PointOfSaleFromJson(Map<String, dynamic> json) => PointOfSale(
  posId: json['pos_id'] as String,
  operatorId: json['operator_id'] as String,
  participationId: json['participation_id'] as String,
  name: json['name'] as String,
);

Map<String, dynamic> _$PointOfSaleToJson(PointOfSale instance) =>
    <String, dynamic>{
      'pos_id': instance.posId,
      'operator_id': instance.operatorId,
      'participation_id': instance.participationId,
      'name': instance.name,
    };
