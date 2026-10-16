// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_organizers_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdOrganizersResponse
_$GetOperatorsOperatorIdOrganizersResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdOrganizersResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => Organizer.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdOrganizersResponseToJson(
  GetOperatorsOperatorIdOrganizersResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
