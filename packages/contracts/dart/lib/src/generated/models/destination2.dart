// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'method2.dart';
import 'new_number_otp.dart';

part 'destination2.g.dart';

@JsonSerializable()
class Destination2 {
  const Destination2({
    required this.method,
    this.msisdn,
    this.newNumberOtp,
    this.iban,
  });

  factory Destination2.fromJson(Map<String, Object?> json) =>
      _$Destination2FromJson(json);

  final Method2 method;
  final String? msisdn;

  /// Obligatoire si `msisdn` n'est pas le numéro vérifié du titulaire (ADR-76).
  @JsonKey(name: 'new_number_otp')
  final NewNumberOtp? newNumberOtp;
  final String? iban;

  Map<String, Object?> toJson() => _$Destination2ToJson(this);
}
