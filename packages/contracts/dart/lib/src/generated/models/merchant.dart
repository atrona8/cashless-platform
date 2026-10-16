// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'merchant.g.dart';

/// Commerçant (partie `MERCHANT`) rattaché à un prestataire. Il ne porte aucune condition commerciale : elles.
/// sont sur ses participations.
///
@JsonSerializable()
class Merchant {
  const Merchant({
    required this.merchantId,
    required this.operatorId,
    required this.legalName,
    required this.countryCode,
    required this.taxId,
    required this.createdAt,
  });

  factory Merchant.fromJson(Map<String, Object?> json) =>
      _$MerchantFromJson(json);

  @JsonKey(name: 'merchant_id')
  final String merchantId;
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

  Map<String, Object?> toJson() => _$MerchantToJson(this);
}
