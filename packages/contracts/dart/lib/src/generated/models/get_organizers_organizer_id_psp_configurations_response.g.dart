// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_organizers_organizer_id_psp_configurations_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOrganizersOrganizerIdPspConfigurationsResponse
_$GetOrganizersOrganizerIdPspConfigurationsResponseFromJson(
  Map<String, dynamic> json,
) => GetOrganizersOrganizerIdPspConfigurationsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => PspConfiguration.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetOrganizersOrganizerIdPspConfigurationsResponseToJson(
  GetOrganizersOrganizerIdPspConfigurationsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
