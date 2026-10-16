// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_organizers_organizer_id_config_versions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdOrganizersOrganizerIdConfigVersionsResponse
_$GetOperatorsOperatorIdOrganizersOrganizerIdConfigVersionsResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdOrganizersOrganizerIdConfigVersionsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => ConfigVersion.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic>
_$GetOperatorsOperatorIdOrganizersOrganizerIdConfigVersionsResponseToJson(
  GetOperatorsOperatorIdOrganizersOrganizerIdConfigVersionsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
