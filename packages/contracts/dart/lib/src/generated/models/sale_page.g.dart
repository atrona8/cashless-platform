// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SalePage _$SalePageFromJson(Map<String, dynamic> json) => SalePage(
  data: (json['data'] as List<dynamic>)
      .map((e) => SaleSummary.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
);

Map<String, dynamic> _$SalePageToJson(SalePage instance) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
