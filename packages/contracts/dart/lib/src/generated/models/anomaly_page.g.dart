// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'anomaly_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AnomalyPage _$AnomalyPageFromJson(Map<String, dynamic> json) => AnomalyPage(
  data: (json['data'] as List<dynamic>)
      .map((e) => Anomaly.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
);

Map<String, dynamic> _$AnomalyPageToJson(AnomalyPage instance) =>
    <String, dynamic>{
      'data': instance.data,
      'next_cursor': instance.nextCursor,
      'has_more': instance.hasMore,
    };
