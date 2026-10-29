// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'psp_configuration_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PspConfigurationCreate _$PspConfigurationCreateFromJson(
  Map<String, dynamic> json,
) => PspConfigurationCreate(
  method: $enumDecode(_$PspProviderEnumMap, json['method']),
  provider: $enumDecode(_$PspConfigurationProviderEnumMap, json['provider']),
  holderPartyId: json['holder_party_id'] as String,
  secretRef: json['secret_ref'] as String,
  validFrom: json['valid_from'] == null
      ? null
      : DateTime.parse(json['valid_from'] as String),
  validUntil: json['valid_until'] == null
      ? null
      : DateTime.parse(json['valid_until'] as String),
  isDefault: json['is_default'] as bool? ?? false,
);

Map<String, dynamic> _$PspConfigurationCreateToJson(
  PspConfigurationCreate instance,
) => <String, dynamic>{
  'method': instance.method,
  'provider': instance.provider,
  'holder_party_id': instance.holderPartyId,
  'secret_ref': instance.secretRef,
  'is_default': instance.isDefault,
  'valid_from': instance.validFrom?.toIso8601String(),
  'valid_until': instance.validUntil?.toIso8601String(),
};

const _$PspProviderEnumMap = {
  PspProvider.wave: 'WAVE',
  PspProvider.orangeMoney: 'ORANGE_MONEY',
  PspProvider.card: 'CARD',
};

const _$PspConfigurationProviderEnumMap = {
  PspConfigurationProvider.wave: 'WAVE',
  PspConfigurationProvider.orangeMoney: 'ORANGE_MONEY',
  PspConfigurationProvider.paydunya: 'PAYDUNYA',
  PspConfigurationProvider.stripe: 'STRIPE',
};
