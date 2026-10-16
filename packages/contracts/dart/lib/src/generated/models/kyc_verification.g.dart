// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'kyc_verification.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

KycVerification _$KycVerificationFromJson(Map<String, dynamic> json) =>
    KycVerification(
      kycVerificationId: json['kyc_verification_id'] as String,
      customerId: json['customer_id'] as String,
      method: $enumDecode(_$KycVerificationMethodEnumMap, json['method']),
      agentId: json['agent_id'] as String,
      idType: json['id_type'] as String,
      idCountry: json['id_country'] as String,
      idLast4: json['id_last4'] as String,
      idExpiresOn: DateTime.parse(json['id_expires_on'] as String),
      status: $enumDecode(_$KycVerificationStatusEnumMap, json['status']),
      verifiedAt: DateTime.parse(json['verified_at'] as String),
      walletId: json['wallet_id'] as String?,
      revokedAt: json['revoked_at'] == null
          ? null
          : DateTime.parse(json['revoked_at'] as String),
      revokedBy: json['revoked_by'] as String?,
      revokedReason: json['revoked_reason'] as String?,
    );

Map<String, dynamic> _$KycVerificationToJson(KycVerification instance) =>
    <String, dynamic>{
      'kyc_verification_id': instance.kycVerificationId,
      'customer_id': instance.customerId,
      'wallet_id': instance.walletId,
      'method': instance.method,
      'agent_id': instance.agentId,
      'id_type': instance.idType,
      'id_country': instance.idCountry,
      'id_last4': instance.idLast4,
      'id_expires_on': instance.idExpiresOn.toIso8601String(),
      'status': instance.status,
      'verified_at': instance.verifiedAt.toIso8601String(),
      'revoked_at': instance.revokedAt?.toIso8601String(),
      'revoked_by': instance.revokedBy,
      'revoked_reason': instance.revokedReason,
    };

const _$KycVerificationMethodEnumMap = {
  KycVerificationMethod.desk: 'DESK',
  KycVerificationMethod.online: 'ONLINE',
};

const _$KycVerificationStatusEnumMap = {
  KycVerificationStatus.verified: 'VERIFIED',
  KycVerificationStatus.revoked: 'REVOKED',
};
