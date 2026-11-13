// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pos2.g.dart';

@JsonSerializable()
class Pos2 {
  const Pos2({
    required this.posId,
    required this.name,
    required this.merchantName,
  });

  factory Pos2.fromJson(Map<String, Object?> json) => _$Pos2FromJson(json);

  @JsonKey(name: 'pos_id')
  final String posId;
  final String name;
  @JsonKey(name: 'merchant_name')
  final String merchantName;

  Map<String, Object?> toJson() => _$Pos2ToJson(this);
}
