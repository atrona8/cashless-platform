// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'contract_version_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ContractVersionCreate _$ContractVersionCreateFromJson(
  Map<String, dynamic> json,
) => ContractVersionCreate(
  validFrom: DateTime.parse(json['valid_from'] as String),
  platformFeeMode: $enumDecodeNullable(
    _$ContractVersionCreatePlatformFeeModeEnumMap,
    json['platform_fee_mode'],
  ),
  offlineLossBearer: $enumDecodeNullable(
    _$ContractVersionCreateOfflineLossBearerEnumMap,
    json['offline_loss_bearer'],
  ),
  cashDiffBearer: $enumDecodeNullable(
    _$ContractVersionCreateCashDiffBearerEnumMap,
    json['cash_diff_bearer'],
  ),
  breakageOrganizerBps: (json['breakage_organizer_bps'] as num?)?.toInt(),
  operatorFeeBasis: $enumDecodeNullable(
    _$ContractVersionCreateOperatorFeeBasisEnumMap,
    json['operator_fee_basis'],
  ),
  chargebackBearer: $enumDecodeNullable(
    _$ContractVersionCreateChargebackBearerEnumMap,
    json['chargeback_bearer'],
  ),
);

Map<String, dynamic> _$ContractVersionCreateToJson(
  ContractVersionCreate instance,
) => <String, dynamic>{
  'valid_from': instance.validFrom.toIso8601String(),
  'platform_fee_mode': instance.platformFeeMode,
  'offline_loss_bearer': instance.offlineLossBearer,
  'cash_diff_bearer': instance.cashDiffBearer,
  'breakage_organizer_bps': instance.breakageOrganizerBps,
  'operator_fee_basis': instance.operatorFeeBasis,
  'chargeback_bearer': instance.chargebackBearer,
};

const _$ContractVersionCreatePlatformFeeModeEnumMap = {
  ContractVersionCreatePlatformFeeMode.inPool: 'IN_POOL',
  ContractVersionCreatePlatformFeeMode.invoiced: 'INVOICED',
};

const _$ContractVersionCreateOfflineLossBearerEnumMap = {
  ContractVersionCreateOfflineLossBearer.organizer: 'ORGANIZER',
  ContractVersionCreateOfflineLossBearer.valueOperator: 'OPERATOR',
};

const _$ContractVersionCreateCashDiffBearerEnumMap = {
  ContractVersionCreateCashDiffBearer.organizer: 'ORGANIZER',
  ContractVersionCreateCashDiffBearer.valueOperator: 'OPERATOR',
};

const _$ContractVersionCreateOperatorFeeBasisEnumMap = {
  ContractVersionCreateOperatorFeeBasis.gross: 'GROSS',
  ContractVersionCreateOperatorFeeBasis.netOfRefunds: 'NET_OF_REFUNDS',
};

const _$ContractVersionCreateChargebackBearerEnumMap = {
  ContractVersionCreateChargebackBearer.organizer: 'ORGANIZER',
  ContractVersionCreateChargebackBearer.valueOperator: 'OPERATOR',
};
