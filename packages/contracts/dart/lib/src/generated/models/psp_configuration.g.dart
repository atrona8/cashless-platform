// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'psp_configuration.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PspConfiguration _$PspConfigurationFromJson(Map<String, dynamic> json) =>
    PspConfiguration(
      pspConfigId: json['psp_config_id'] as String,
      organizerId: json['organizer_id'] as String,
      method: $enumDecode(_$PspProviderEnumMap, json['method']),
      provider: $enumDecode(
        _$PspConfigurationProviderEnumMap,
        json['provider'],
      ),
      holderPartyId: json['holder_party_id'] as String,
      status: $enumDecode(_$PspConfigurationStatusEnumMap, json['status']),
      isDefault: json['is_default'] as bool,
      version: (json['version'] as num).toInt(),
      createdBy: json['created_by'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      secretRef: json['secret_ref'] as String?,
      complianceRef: json['compliance_ref'] as String?,
      validFrom: json['valid_from'] == null
          ? null
          : DateTime.parse(json['valid_from'] as String),
      validUntil: json['valid_until'] == null
          ? null
          : DateTime.parse(json['valid_until'] as String),
      approvedBy: json['approved_by'] as String?,
    );

Map<String, dynamic> _$PspConfigurationToJson(PspConfiguration instance) =>
    <String, dynamic>{
      'psp_config_id': instance.pspConfigId,
      'organizer_id': instance.organizerId,
      'method': instance.method,
      'provider': instance.provider,
      'holder_party_id': instance.holderPartyId,
      'secret_ref': instance.secretRef,
      'compliance_ref': instance.complianceRef,
      'status': instance.status,
      'is_default': instance.isDefault,
      'valid_from': instance.validFrom?.toIso8601String(),
      'valid_until': instance.validUntil?.toIso8601String(),
      'version': instance.version,
      'created_by': instance.createdBy,
      'approved_by': instance.approvedBy,
      'created_at': instance.createdAt.toIso8601String(),
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

const _$PspConfigurationStatusEnumMap = {
  PspConfigurationStatus.draft: 'DRAFT',
  PspConfigurationStatus.active: 'ACTIVE',
  PspConfigurationStatus.suspended: 'SUSPENDED',
};
