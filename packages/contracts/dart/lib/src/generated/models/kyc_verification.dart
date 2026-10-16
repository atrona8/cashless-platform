// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'kyc_verification_method.dart';
import 'kyc_verification_status.dart';
import 'timestamp.dart';

part 'kyc_verification.g.dart';

@JsonSerializable()
class KycVerification {
  const KycVerification({
    required this.kycVerificationId,
    required this.customerId,
    required this.method,
    required this.agentId,
    required this.idType,
    required this.idCountry,
    required this.idLast4,
    required this.idExpiresOn,
    required this.status,
    required this.verifiedAt,
    this.walletId,
    this.revokedAt,
    this.revokedBy,
    this.revokedReason,
  });

  factory KycVerification.fromJson(Map<String, Object?> json) =>
      _$KycVerificationFromJson(json);

  @JsonKey(name: 'kyc_verification_id')
  final String kycVerificationId;
  @JsonKey(name: 'customer_id')
  final String customerId;
  @JsonKey(name: 'wallet_id')
  final String? walletId;

  /// `ONLINE` réservé (V2).
  final KycVerificationMethod method;
  @JsonKey(name: 'agent_id')
  final String agentId;
  @JsonKey(name: 'id_type')
  final String idType;
  @JsonKey(name: 'id_country')
  final String idCountry;
  @JsonKey(name: 'id_last4')
  final String idLast4;
  @JsonKey(name: 'id_expires_on')
  final DateTime idExpiresOn;
  final KycVerificationStatus status;
  @JsonKey(name: 'verified_at')
  final Timestamp verifiedAt;
  @JsonKey(name: 'revoked_at')
  final DateTime? revokedAt;
  @JsonKey(name: 'revoked_by')
  final String? revokedBy;
  @JsonKey(name: 'revoked_reason')
  final String? revokedReason;

  Map<String, Object?> toJson() => _$KycVerificationToJson(this);
}
