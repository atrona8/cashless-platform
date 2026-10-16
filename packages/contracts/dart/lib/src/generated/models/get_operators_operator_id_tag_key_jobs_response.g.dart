// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_tag_key_jobs_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdTagKeyJobsResponse
_$GetOperatorsOperatorIdTagKeyJobsResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdTagKeyJobsResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => TagKeyJob.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdTagKeyJobsResponseToJson(
  GetOperatorsOperatorIdTagKeyJobsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
