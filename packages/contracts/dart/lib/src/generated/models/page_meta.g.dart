// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'page_meta.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PageMeta _$PageMetaFromJson(Map<String, dynamic> json) => PageMeta(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
);

Map<String, dynamic> _$PageMetaToJson(PageMeta instance) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
