// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_account_mappings_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdAccountMappingsResponse
_$GetOperatorsOperatorIdAccountMappingsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdAccountMappingsResponse(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
  data: (json['data'] as List<dynamic>)
      .map((e) => AccountMappingVersion.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetOperatorsOperatorIdAccountMappingsResponseToJson(
  GetOperatorsOperatorIdAccountMappingsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
