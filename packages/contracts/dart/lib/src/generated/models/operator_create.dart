// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'operator_create.g.dart';

@JsonSerializable()
class OperatorCreate {
  const OperatorCreate({
    required this.legalName,
    required this.countryCode,
    this.taxId,
  });

  factory OperatorCreate.fromJson(Map<String, Object?> json) =>
      _$OperatorCreateFromJson(json);

  @JsonKey(name: 'legal_name')
  final String legalName;
  @JsonKey(name: 'country_code')
  final String countryCode;
  @JsonKey(name: 'tax_id')
  final String? taxId;

  Map<String, Object?> toJson() => _$OperatorCreateToJson(this);
}
