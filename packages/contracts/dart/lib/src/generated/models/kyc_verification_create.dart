// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'kyc_verification_create_id_type.dart';

part 'kyc_verification_create.g.dart';

@JsonSerializable()
class KycVerificationCreate {
  const KycVerificationCreate({
    required this.idType,
    required this.idCountry,
    required this.idLast4,
    required this.idExpiresOn,
    this.customerId,
    this.walletId,
  });

  factory KycVerificationCreate.fromJson(Map<String, Object?> json) =>
      _$KycVerificationCreateFromJson(json);

  @JsonKey(name: 'customer_id')
  final String? customerId;

  /// Portefeuille présenté au guichet ; son client est identifié.
  @JsonKey(name: 'wallet_id')
  final String? walletId;
  @JsonKey(name: 'id_type')
  final KycVerificationCreateIdType idType;
  @JsonKey(name: 'id_country')
  final String idCountry;

  /// 4 derniers caractères du numéro seulement.
  @JsonKey(name: 'id_last4')
  final String idLast4;
  @JsonKey(name: 'id_expires_on')
  final DateTime idExpiresOn;

  Map<String, Object?> toJson() => _$KycVerificationCreateToJson(this);
}
