// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_merchants_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdMerchantsResponse
_$GetOperatorsOperatorIdMerchantsResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdMerchantsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => Merchant.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdMerchantsResponseToJson(
  GetOperatorsOperatorIdMerchantsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
