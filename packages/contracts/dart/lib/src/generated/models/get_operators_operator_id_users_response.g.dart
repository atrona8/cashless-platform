// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_users_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdUsersResponse
_$GetOperatorsOperatorIdUsersResponseFromJson(Map<String, dynamic> json) =>
    GetOperatorsOperatorIdUsersResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => StaffUser.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
      nextCursor: json['next_cursor'] as String?,
    );

Map<String, dynamic> _$GetOperatorsOperatorIdUsersResponseToJson(
  GetOperatorsOperatorIdUsersResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
