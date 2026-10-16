// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_fee_rules_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdFeeRulesResponse
_$GetOperatorsOperatorIdFeeRulesResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdFeeRulesResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => FeeRule.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdFeeRulesResponseToJson(
  GetOperatorsOperatorIdFeeRulesResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
