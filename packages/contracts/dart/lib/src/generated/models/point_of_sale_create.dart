// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'point_of_sale_create.g.dart';

@JsonSerializable()
class PointOfSaleCreate {
  const PointOfSaleCreate({required this.name});

  factory PointOfSaleCreate.fromJson(Map<String, Object?> json) =>
      _$PointOfSaleCreateFromJson(json);

  final String name;

  Map<String, Object?> toJson() => _$PointOfSaleCreateToJson(this);
}
