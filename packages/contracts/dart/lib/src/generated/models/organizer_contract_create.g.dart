// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'organizer_contract_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OrganizerContractCreate _$OrganizerContractCreateFromJson(
  Map<String, dynamic> json,
) => OrganizerContractCreate(
  validFrom: DateTime.parse(json['valid_from'] as String),
  offlineLossBearer: $enumDecode(
    _$OrganizerContractCreateOfflineLossBearerEnumMap,
    json['offline_loss_bearer'],
  ),
  cashDiffBearer: $enumDecode(
    _$OrganizerContractCreateCashDiffBearerEnumMap,
    json['cash_diff_bearer'],
  ),
  breakageOrganizerBps: (json['breakage_organizer_bps'] as num).toInt(),
  operatorFeeBasis:
      $enumDecodeNullable(
        _$OrganizerContractCreateOperatorFeeBasisEnumMap,
        json['operator_fee_basis'],
      ) ??
      OrganizerContractCreateOperatorFeeBasis.gross,
  chargebackBearer:
      $enumDecodeNullable(
        _$OrganizerContractCreateChargebackBearerEnumMap,
        json['chargeback_bearer'],
      ) ??
      OrganizerContractCreateChargebackBearer.organizer,
);

Map<String, dynamic> _$OrganizerContractCreateToJson(
  OrganizerContractCreate instance,
) => <String, dynamic>{
  'valid_from': instance.validFrom.toIso8601String(),
  'offline_loss_bearer': instance.offlineLossBearer,
  'cash_diff_bearer': instance.cashDiffBearer,
  'breakage_organizer_bps': instance.breakageOrganizerBps,
  'operator_fee_basis': instance.operatorFeeBasis,
  'chargeback_bearer': instance.chargebackBearer,
};

const _$OrganizerContractCreateOfflineLossBearerEnumMap = {
  OrganizerContractCreateOfflineLossBearer.organizer: 'ORGANIZER',
  OrganizerContractCreateOfflineLossBearer.valueOperator: 'OPERATOR',
};

const _$OrganizerContractCreateCashDiffBearerEnumMap = {
  OrganizerContractCreateCashDiffBearer.organizer: 'ORGANIZER',
  OrganizerContractCreateCashDiffBearer.valueOperator: 'OPERATOR',
};

const _$OrganizerContractCreateOperatorFeeBasisEnumMap = {
  OrganizerContractCreateOperatorFeeBasis.gross: 'GROSS',
  OrganizerContractCreateOperatorFeeBasis.netOfRefunds: 'NET_OF_REFUNDS',
};

const _$OrganizerContractCreateChargebackBearerEnumMap = {
  OrganizerContractCreateChargebackBearer.organizer: 'ORGANIZER',
  OrganizerContractCreateChargebackBearer.valueOperator: 'OPERATOR',
};
