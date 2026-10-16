// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'customer_profile.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CustomerProfile _$CustomerProfileFromJson(Map<String, dynamic> json) =>
    CustomerProfile(
      customerId: json['customer_id'] as String,
      phone: json['phone'] as String,
      kycLevel: $enumDecode(
        _$CustomerProfileKycLevelEnumMap,
        json['kyc_level'],
      ),
      displayName: json['display_name'] as String?,
    );

Map<String, dynamic> _$CustomerProfileToJson(CustomerProfile instance) =>
    <String, dynamic>{
      'customer_id': instance.customerId,
      'phone': instance.phone,
      'display_name': instance.displayName,
      'kyc_level': instance.kycLevel,
    };

const _$CustomerProfileKycLevelEnumMap = {
  CustomerProfileKycLevel.none: 'NONE',
  CustomerProfileKycLevel.verified: 'VERIFIED',
};
