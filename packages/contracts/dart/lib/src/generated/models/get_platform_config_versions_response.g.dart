// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_platform_config_versions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetPlatformConfigVersionsResponse _$GetPlatformConfigVersionsResponseFromJson(
  Map<String, dynamic> json,
) => GetPlatformConfigVersionsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => ConfigVersion.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetPlatformConfigVersionsResponseToJson(
  GetPlatformConfigVersionsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
