// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_tag_key_check_runs_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdTagKeyCheckRunsResponse
_$GetOperatorsOperatorIdTagKeyCheckRunsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdTagKeyCheckRunsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => TagKeyCheckRun.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetOperatorsOperatorIdTagKeyCheckRunsResponseToJson(
  GetOperatorsOperatorIdTagKeyCheckRunsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
