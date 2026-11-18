// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'method3.dart';

part 'destination4.g.dart';

@JsonSerializable()
class Destination4 {
  const Destination4({required this.method, this.msisdn, this.iban});

  factory Destination4.fromJson(Map<String, Object?> json) =>
      _$Destination4FromJson(json);

  final Method3 method;
  final String? msisdn;
  final String? iban;

  Map<String, Object?> toJson() => _$Destination4ToJson(this);
}
