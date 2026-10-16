// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'kyc_verification_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

KycVerificationCreate _$KycVerificationCreateFromJson(
  Map<String, dynamic> json,
) => KycVerificationCreate(
  idType: $enumDecode(_$KycVerificationCreateIdTypeEnumMap, json['id_type']),
  idCountry: json['id_country'] as String,
  idLast4: json['id_last4'] as String,
  idExpiresOn: DateTime.parse(json['id_expires_on'] as String),
  customerId: json['customer_id'] as String?,
  walletId: json['wallet_id'] as String?,
);

Map<String, dynamic> _$KycVerificationCreateToJson(
  KycVerificationCreate instance,
) => <String, dynamic>{
  'customer_id': instance.customerId,
  'wallet_id': instance.walletId,
  'id_type': instance.idType,
  'id_country': instance.idCountry,
  'id_last4': instance.idLast4,
  'id_expires_on': instance.idExpiresOn.toIso8601String(),
};

const _$KycVerificationCreateIdTypeEnumMap = {
  KycVerificationCreateIdType.nationalId: 'NATIONAL_ID',
  KycVerificationCreateIdType.passport: 'PASSPORT',
  KycVerificationCreateIdType.residencePermit: 'RESIDENCE_PERMIT',
  KycVerificationCreateIdType.drivingLicence: 'DRIVING_LICENCE',
  KycVerificationCreateIdType.other: 'OTHER',
};
