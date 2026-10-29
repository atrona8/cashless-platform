// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'method2.dart';

part 'destination.g.dart';

@JsonSerializable()
class Destination {
  const Destination({required this.method, this.msisdn, this.iban});

  factory Destination.fromJson(Map<String, Object?> json) =>
      _$DestinationFromJson(json);

  final Method2 method;
  final String? msisdn;
  final String? iban;

  Map<String, Object?> toJson() => _$DestinationToJson(this);
}
