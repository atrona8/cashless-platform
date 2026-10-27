// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'vendor.dart';

part 'vendor_page.g.dart';

@JsonSerializable()
class VendorPage {
  const VendorPage({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory VendorPage.fromJson(Map<String, Object?> json) =>
      _$VendorPageFromJson(json);

  final List<Vendor> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$VendorPageToJson(this);
}
