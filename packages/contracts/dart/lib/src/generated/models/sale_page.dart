// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'sale_summary.dart';

part 'sale_page.g.dart';

@JsonSerializable()
class SalePage {
  const SalePage({
    required this.data,
    required this.nextCursor,
    required this.hasMore,
  });

  factory SalePage.fromJson(Map<String, Object?> json) =>
      _$SalePageFromJson(json);

  final List<SaleSummary> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$SalePageToJson(this);
}
