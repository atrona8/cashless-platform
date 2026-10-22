// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DevicePage _$DevicePageFromJson(Map<String, dynamic> json) => DevicePage(
  data: (json['data'] as List<dynamic>)
      .map((e) => DeviceAdmin.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$DevicePageToJson(DevicePage instance) =>
    <String, dynamic>{
      'data': instance.data,
      'next_cursor': instance.nextCursor,
      'has_more': instance.hasMore,
    };
