// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'catalog_item.dart';

part 'catalog.g.dart';

@JsonSerializable()
class Catalog {
  const Catalog({this.version, this.items});

  factory Catalog.fromJson(Map<String, Object?> json) =>
      _$CatalogFromJson(json);

  final int? version;
  final List<CatalogItem>? items;

  Map<String, Object?> toJson() => _$CatalogToJson(this);
}
