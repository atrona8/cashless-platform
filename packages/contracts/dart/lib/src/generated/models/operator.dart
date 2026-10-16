// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'operator.g.dart';

/// Prestataire (partie `OPERATOR`, §3.1), unité d'isolation des données.
@JsonSerializable()
class Operator {
  const Operator({
    required this.operatorId,
    required this.legalName,
    required this.countryCode,
    required this.taxId,
    required this.createdAt,
  });

  factory Operator.fromJson(Map<String, Object?> json) =>
      _$OperatorFromJson(json);

  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'legal_name')
  final String legalName;
  @JsonKey(name: 'country_code')
  final String? countryCode;
  @JsonKey(name: 'tax_id')
  final String? taxId;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;

  Map<String, Object?> toJson() => _$OperatorToJson(this);
}
