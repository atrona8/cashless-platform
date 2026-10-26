// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'vendor_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

VendorPage _$VendorPageFromJson(Map<String, dynamic> json) => VendorPage(
  data: (json['data'] as List<dynamic>)
      .map((e) => Vendor.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic> _$VendorPageToJson(VendorPage instance) =>
    <String, dynamic>{
      'data': instance.data,
      'next_cursor': instance.nextCursor,
      'has_more': instance.hasMore,
    };
