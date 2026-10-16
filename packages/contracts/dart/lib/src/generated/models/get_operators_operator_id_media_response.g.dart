// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_media_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdMediaResponse
_$GetOperatorsOperatorIdMediaResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdMediaResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => MediaAdmin.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdMediaResponseToJson(
  GetOperatorsOperatorIdMediaResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
