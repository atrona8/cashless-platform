// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_platform_fee_rules_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdPlatformFeeRulesResponse
_$GetOperatorsOperatorIdPlatformFeeRulesResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdPlatformFeeRulesResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => FeeRule.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetOperatorsOperatorIdPlatformFeeRulesResponseToJson(
  GetOperatorsOperatorIdPlatformFeeRulesResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
