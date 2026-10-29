// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'fee_rule_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FeeRuleCreate _$FeeRuleCreateFromJson(Map<String, dynamic> json) =>
    FeeRuleCreate(
      scopeType: $enumDecode(_$FeeRuleScopeTypeEnumMap, json['scope_type']),
      scopeId: json['scope_id'] as String,
      payerPurpose: json['payer_purpose'] as String,
      beneficiaryPurpose: json['beneficiary_purpose'] as String,
      basis: $enumDecode(_$FeeRuleCreateBasisEnumMap, json['basis']),
      trigger: $enumDecode(_$FeeRuleCreateTriggerEnumMap, json['trigger']),
      minAmount: (json['min_amount'] as num?)?.toInt(),
      maxAmount: (json['max_amount'] as num?)?.toInt(),
      taxCode: json['tax_code'] as String?,
      validFrom: json['valid_from'] == null
          ? null
          : DateTime.parse(json['valid_from'] as String),
      rateBps: (json['rate_bps'] as num?)?.toInt() ?? 0,
      fixedAmount: (json['fixed_amount'] as num?)?.toInt() ?? 0,
      taxInclusive: json['tax_inclusive'] as bool? ?? true,
    );

Map<String, dynamic> _$FeeRuleCreateToJson(FeeRuleCreate instance) =>
    <String, dynamic>{
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
      'valid_from': instance.validFrom?.toIso8601String(),
    };

const _$FeeRuleScopeTypeEnumMap = {
  FeeRuleScopeType.platformContract: 'PLATFORM_CONTRACT',
  FeeRuleScopeType.operatorContract: 'OPERATOR_CONTRACT',
  FeeRuleScopeType.event: 'EVENT',
  FeeRuleScopeType.participation: 'PARTICIPATION',
  FeeRuleScopeType.pspConfiguration: 'PSP_CONFIGURATION',
};

const _$FeeRuleCreateBasisEnumMap = {
  FeeRuleCreateBasis.topupAmount: 'TOPUP_AMOUNT',
  FeeRuleCreateBasis.saleAmount: 'SALE_AMOUNT',
  FeeRuleCreateBasis.perMedia: 'PER_MEDIA',
  FeeRuleCreateBasis.perTerminalDay: 'PER_TERMINAL_DAY',
  FeeRuleCreateBasis.perRefund: 'PER_REFUND',
  FeeRuleCreateBasis.fixed: 'FIXED',
  FeeRuleCreateBasis.feeAmount: 'FEE_AMOUNT',
};

const _$FeeRuleCreateTriggerEnumMap = {
  FeeRuleCreateTrigger.realtime: 'REALTIME',
  FeeRuleCreateTrigger.closing: 'CLOSING',
};
