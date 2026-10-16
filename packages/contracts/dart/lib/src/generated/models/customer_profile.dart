// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'customer_profile_kyc_level.dart';

part 'customer_profile.g.dart';

@JsonSerializable()
class CustomerProfile {
  const CustomerProfile({
    required this.customerId,
    required this.phone,
    required this.kycLevel,
    this.displayName,
  });

  factory CustomerProfile.fromJson(Map<String, Object?> json) =>
      _$CustomerProfileFromJson(json);

  @JsonKey(name: 'customer_id')
  final String customerId;
  final String phone;
  @JsonKey(name: 'display_name')
  final String? displayName;

  /// Calculé à la lecture (ADR-54) — VERIFIED tant que le client a une identification non révoquée et une pièce non expirée.
  @JsonKey(name: 'kyc_level')
  final CustomerProfileKycLevel kycLevel;

  Map<String, Object?> toJson() => _$CustomerProfileToJson(this);
}
