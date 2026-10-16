// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_tag_keys_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdTagKeysResponse
_$GetOperatorsOperatorIdTagKeysResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdTagKeysResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => TagKey.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdTagKeysResponseToJson(
  GetOperatorsOperatorIdTagKeysResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
