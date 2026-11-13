// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_local_order.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeLocalOrder _$EdgeLocalOrderFromJson(Map<String, dynamic> json) =>
    EdgeLocalOrder(
      type: $enumDecode(_$EdgeLocalOrderTypeEnumMap, json['type']),
      gatewayId: json['gateway_id'] as String,
      holders: (json['holders'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      at: DateTime.parse(json['at'] as String),
      orderSha256: json['order_sha256'] as String,
    );

Map<String, dynamic> _$EdgeLocalOrderToJson(EdgeLocalOrder instance) =>
    <String, dynamic>{
      'type': instance.type,
      'gateway_id': instance.gatewayId,
      'holders': instance.holders,
      'at': instance.at.toIso8601String(),
      'order_sha256': instance.orderSha256,
    };

const _$EdgeLocalOrderTypeEnumMap = {
  EdgeLocalOrderType.localUnstale: 'LOCAL_UNSTALE',
  EdgeLocalOrderType.purge: 'PURGE',
};
