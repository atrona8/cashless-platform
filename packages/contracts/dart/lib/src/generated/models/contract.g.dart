// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'contract.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Contract _$ContractFromJson(Map<String, dynamic> json) => Contract(
  contractId: json['contract_id'] as String,
  operatorId: json['operator_id'] as String,
  kind: $enumDecode(_$ContractKindEnumMap, json['kind']),
  counterpartyId: json['counterparty_id'] as String,
  version: (json['version'] as num).toInt(),
  validFrom: DateTime.parse(json['valid_from'] as String),
  operatorFeeBasis: $enumDecode(
    _$ContractOperatorFeeBasisEnumMap,
    json['operator_fee_basis'],
  ),
  chargebackBearer: $enumDecode(
    _$ContractChargebackBearerEnumMap,
    json['chargeback_bearer'],
  ),
  platformFeeMode: $enumDecodeNullable(
    _$ContractPlatformFeeModeEnumMap,
    json['platform_fee_mode'],
  ),
  offlineLossBearer: $enumDecodeNullable(
    _$ContractOfflineLossBearerEnumMap,
    json['offline_loss_bearer'],
  ),
  cashDiffBearer: $enumDecodeNullable(
    _$ContractCashDiffBearerEnumMap,
    json['cash_diff_bearer'],
  ),
  breakageOrganizerBps: (json['breakage_organizer_bps'] as num?)?.toInt(),
);

Map<String, dynamic> _$ContractToJson(Contract instance) => <String, dynamic>{
  'contract_id': instance.contractId,
  'operator_id': instance.operatorId,
  'kind': instance.kind,
  'counterparty_id': instance.counterpartyId,
  'version': instance.version,
  'valid_from': instance.validFrom.toIso8601String(),
  'platform_fee_mode': instance.platformFeeMode,
  'offline_loss_bearer': instance.offlineLossBearer,
  'cash_diff_bearer': instance.cashDiffBearer,
  'breakage_organizer_bps': instance.breakageOrganizerBps,
  'operator_fee_basis': instance.operatorFeeBasis,
  'chargeback_bearer': instance.chargebackBearer,
};

const _$ContractKindEnumMap = {
  ContractKind.platformOperator: 'PLATFORM_OPERATOR',
  ContractKind.operatorOrganizer: 'OPERATOR_ORGANIZER',
};

const _$ContractOperatorFeeBasisEnumMap = {
  ContractOperatorFeeBasis.gross: 'GROSS',
  ContractOperatorFeeBasis.netOfRefunds: 'NET_OF_REFUNDS',
};

const _$ContractChargebackBearerEnumMap = {
  ContractChargebackBearer.organizer: 'ORGANIZER',
  ContractChargebackBearer.valueOperator: 'OPERATOR',
};

const _$ContractPlatformFeeModeEnumMap = {
  ContractPlatformFeeMode.inPool: 'IN_POOL',
  ContractPlatformFeeMode.invoiced: 'INVOICED',
  ContractPlatformFeeMode.valueNull: null,
};

const _$ContractOfflineLossBearerEnumMap = {
  ContractOfflineLossBearer.organizer: 'ORGANIZER',
  ContractOfflineLossBearer.valueOperator: 'OPERATOR',
  ContractOfflineLossBearer.valueNull: null,
};

const _$ContractCashDiffBearerEnumMap = {
  ContractCashDiffBearer.organizer: 'ORGANIZER',
  ContractCashDiffBearer.valueOperator: 'OPERATOR',
  ContractCashDiffBearer.valueNull: null,
};
