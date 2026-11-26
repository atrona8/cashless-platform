// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'phone_model_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PhoneModelPage _$PhoneModelPageFromJson(Map<String, dynamic> json) =>
    PhoneModelPage(
      data: (json['data'] as List<dynamic>)
          .map((e) => PhoneModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: json['next_cursor'] as String?,
      hasMore: json['has_more'] as bool,
    );

Map<String, dynamic> _$PhoneModelPageToJson(PhoneModelPage instance) =>
    <String, dynamic>{
      'data': instance.data,
      'next_cursor': instance.nextCursor,
      'has_more': instance.hasMore,
    };
