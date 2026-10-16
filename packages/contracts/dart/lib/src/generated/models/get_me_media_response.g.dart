// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_me_media_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetMeMediaResponse _$GetMeMediaResponseFromJson(Map<String, dynamic> json) =>
    GetMeMediaResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => CustomerMedia.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetMeMediaResponseToJson(GetMeMediaResponse instance) =>
    <String, dynamic>{'data': instance.data};
