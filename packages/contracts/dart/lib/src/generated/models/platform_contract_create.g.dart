// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'platform_contract_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PlatformContractCreate _$PlatformContractCreateFromJson(
  Map<String, dynamic> json,
) => PlatformContractCreate(
  validFrom: DateTime.parse(json['valid_from'] as String),
  platformFeeMode: $enumDecode(
    _$PlatformContractCreatePlatformFeeModeEnumMap,
    json['platform_fee_mode'],
  ),
);

Map<String, dynamic> _$PlatformContractCreateToJson(
  PlatformContractCreate instance,
) => <String, dynamic>{
  'valid_from': instance.validFrom.toIso8601String(),
  'platform_fee_mode': instance.platformFeeMode,
};

const _$PlatformContractCreatePlatformFeeModeEnumMap = {
  PlatformContractCreatePlatformFeeMode.inPool: 'IN_POOL',
  PlatformContractCreatePlatformFeeMode.invoiced: 'INVOICED',
};
