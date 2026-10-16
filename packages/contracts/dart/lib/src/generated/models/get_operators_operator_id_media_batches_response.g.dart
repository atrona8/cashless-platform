// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_media_batches_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdMediaBatchesResponse
_$GetOperatorsOperatorIdMediaBatchesResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdMediaBatchesResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => MediaBatch.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetOperatorsOperatorIdMediaBatchesResponseToJson(
  GetOperatorsOperatorIdMediaBatchesResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
