// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsResponse _$GetOperatorsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Operator.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetOperatorsResponseToJson(
  GetOperatorsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
