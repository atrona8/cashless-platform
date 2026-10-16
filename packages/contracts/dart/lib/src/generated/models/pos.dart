// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pos.g.dart';

@JsonSerializable()
class Pos {
  const Pos({this.posId, this.name, this.merchantName});

  factory Pos.fromJson(Map<String, Object?> json) => _$PosFromJson(json);

  @JsonKey(name: 'pos_id')
  final String? posId;
  final String? name;
  @JsonKey(name: 'merchant_name')
  final String? merchantName;

  Map<String, Object?> toJson() => _$PosToJson(this);
}
