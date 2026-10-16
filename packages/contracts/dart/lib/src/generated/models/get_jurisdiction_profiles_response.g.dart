// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_jurisdiction_profiles_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetJurisdictionProfilesResponse _$GetJurisdictionProfilesResponseFromJson(
  Map<String, dynamic> json,
) => GetJurisdictionProfilesResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => JurisdictionProfile.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$GetJurisdictionProfilesResponseToJson(
  GetJurisdictionProfilesResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
