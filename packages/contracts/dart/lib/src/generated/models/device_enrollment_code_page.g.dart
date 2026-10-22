// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_enrollment_code_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceEnrollmentCodePage _$DeviceEnrollmentCodePageFromJson(
  Map<String, dynamic> json,
) => DeviceEnrollmentCodePage(
  data: (json['data'] as List<dynamic>)
      .map(
        (e) => DeviceEnrollmentCodeSummary.fromJson(e as Map<String, dynamic>),
      )
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$DeviceEnrollmentCodePageToJson(
  DeviceEnrollmentCodePage instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
