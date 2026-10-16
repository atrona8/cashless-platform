// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'destination3.g.dart';

@JsonSerializable()
class Destination3 {
  const Destination3({this.method, this.msisdn, this.iban});

  factory Destination3.fromJson(Map<String, Object?> json) =>
      _$Destination3FromJson(json);

  final String? method;
  final String? msisdn;
  final String? iban;

  Map<String, Object?> toJson() => _$Destination3ToJson(this);
}
