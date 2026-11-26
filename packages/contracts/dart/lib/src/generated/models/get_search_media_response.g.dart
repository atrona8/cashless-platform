// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_search_media_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetSearchMediaResponse _$GetSearchMediaResponseFromJson(
  Map<String, dynamic> json,
) => GetSearchMediaResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => MediaSearchResult.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetSearchMediaResponseToJson(
  GetSearchMediaResponse instance,
) => <String, dynamic>{'data': instance.data};
