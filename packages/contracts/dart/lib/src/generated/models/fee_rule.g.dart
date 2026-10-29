// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'fee_rule.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FeeRule _$FeeRuleFromJson(Map<String, dynamic> json) => FeeRule(
  feeRuleId: json['fee_rule_id'] as String,
  operatorId: json['operator_id'] as String?,
  scopeType: $enumDecode(_$FeeRuleScopeTypeEnumMap, json['scope_type']),
  scopeId: json['scope_id'] as String,
  payerPurpose: json['payer_purpose'] as String,
  beneficiaryPurpose: json['beneficiary_purpose'] as String,
  basis: $enumDecode(_$FeeRuleBasisEnumMap, json['basis']),
  rateBps: (json['rate_bps'] as num).toInt(),
  fixedAmount: (json['fixed_amount'] as num).toInt(),
  minAmount: (json['min_amount'] as num?)?.toInt(),
  maxAmount: (json['max_amount'] as num?)?.toInt(),
  taxCode: json['tax_code'] as String?,
  taxInclusive: json['tax_inclusive'] as bool,
  trigger: $enumDecode(_$FeeRuleTriggerEnumMap, json['trigger']),
  validFrom: DateTime.parse(json['valid_from'] as String),
  validTo: json['valid_to'] == null
      ? null
      : DateTime.parse(json['valid_to'] as String),
  version: (json['version'] as num).toInt(),
);

Map<String, dynamic> _$FeeRuleToJson(FeeRule instance) => <String, dynamic>{
  'fee_rule_id': instance.feeRuleId,
  'operator_id': instance.operatorId,
  'scope_type': instance.scopeType,
  'scope_id': instance.scopeId,
  'payer_purpose': instance.payerPurpose,
  'beneficiary_purpose': instance.beneficiaryPurpose,
  'basis': instance.basis,
  'rate_bps': instance.rateBps,
  'fixed_amount': instance.fixedAmount,
  'min_amount': instance.minAmount,
  'max_amount': instance.maxAmount,
  'tax_code': instance.taxCode,
  'tax_inclusive': instance.taxInclusive,
  'trigger': instance.trigger,
  'valid_from': instance.validFrom.toIso8601String(),
  'valid_to': instance.validTo?.toIso8601String(),
  'version': instance.version,
};

const _$FeeRuleScopeTypeEnumMap = {
  FeeRuleScopeType.platformContract: 'PLATFORM_CONTRACT',
  FeeRuleScopeType.operatorContract: 'OPERATOR_CONTRACT',
  FeeRuleScopeType.event: 'EVENT',
  FeeRuleScopeType.participation: 'PARTICIPATION',
  FeeRuleScopeType.pspConfiguration: 'PSP_CONFIGURATION',
};

const _$FeeRuleBasisEnumMap = {
  FeeRuleBasis.topupAmount: 'TOPUP_AMOUNT',
  FeeRuleBasis.saleAmount: 'SALE_AMOUNT',
  FeeRuleBasis.perMedia: 'PER_MEDIA',
  FeeRuleBasis.perTerminalDay: 'PER_TERMINAL_DAY',
  FeeRuleBasis.perRefund: 'PER_REFUND',
  FeeRuleBasis.fixed: 'FIXED',
  FeeRuleBasis.feeAmount: 'FEE_AMOUNT',
};

const _$FeeRuleTriggerEnumMap = {
  FeeRuleTrigger.realtime: 'REALTIME',
  FeeRuleTrigger.closing: 'CLOSING',
};
