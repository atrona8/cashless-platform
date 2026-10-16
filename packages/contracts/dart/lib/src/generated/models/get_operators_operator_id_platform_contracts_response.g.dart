// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_platform_contracts_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdPlatformContractsResponse
_$GetOperatorsOperatorIdPlatformContractsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdPlatformContractsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Contract.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetOperatorsOperatorIdPlatformContractsResponseToJson(
  GetOperatorsOperatorIdPlatformContractsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
