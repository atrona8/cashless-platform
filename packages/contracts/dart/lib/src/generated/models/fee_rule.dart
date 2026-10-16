// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'fee_rule_basis.dart';
import 'fee_rule_scope_type.dart';
import 'fee_rule_trigger.dart';
import 'timestamp.dart';

part 'fee_rule.g.dart';

/// Règle de frais (`fee_rule`, §5.6). Jamais modifiée : elle se ferme (`valid_to`) et une nouvelle version la.
/// remplace. Montants en unités mineures.
///
@JsonSerializable()
class FeeRule {
  const FeeRule({
    required this.feeRuleId,
    required this.operatorId,
    required this.scopeType,
    required this.scopeId,
    required this.payerPurpose,
    required this.beneficiaryPurpose,
    required this.basis,
    required this.rateBps,
    required this.fixedAmount,
    required this.minAmount,
    required this.maxAmount,
    required this.taxCode,
    required this.taxInclusive,
    required this.trigger,
    required this.validFrom,
    required this.validTo,
    required this.version,
  });

  factory FeeRule.fromJson(Map<String, Object?> json) =>
      _$FeeRuleFromJson(json);

  @JsonKey(name: 'fee_rule_id')
  final String feeRuleId;
  @JsonKey(name: 'operator_id')
  final String? operatorId;
  @JsonKey(name: 'scope_type')
  final FeeRuleScopeType scopeType;

  /// Contrat, événement ou participation, selon `scope_type`.
  @JsonKey(name: 'scope_id')
  final String scopeId;

  /// Usage du compte payeur (`ORG_FPREST`, `MERCHANT`, `OPE_REDEV`…), §5.2.
  @JsonKey(name: 'payer_purpose')
  final String payerPurpose;

  /// Usage du compte bénéficiaire (`OPE_FRAIS`, `ORG_COM`, `PLT_REDEV`…).
  @JsonKey(name: 'beneficiary_purpose')
  final String beneficiaryPurpose;
  final FeeRuleBasis basis;

  /// Taux en points de base (1200 = 12 %).
  @JsonKey(name: 'rate_bps')
  final int rateBps;
  @JsonKey(name: 'fixed_amount')
  final int fixedAmount;
  @JsonKey(name: 'min_amount')
  final int? minAmount;
  @JsonKey(name: 'max_amount')
  final int? maxAmount;

  /// Taxe du profil de législation (`rules.taxes`) ; `null` = hors taxe.
  @JsonKey(name: 'tax_code')
  final String? taxCode;
  @JsonKey(name: 'tax_inclusive')
  final bool taxInclusive;
  final FeeRuleTrigger trigger;
  @JsonKey(name: 'valid_from')
  final Timestamp validFrom;
  @JsonKey(name: 'valid_to')
  final DateTime? validTo;
  final int version;

  Map<String, Object?> toJson() => _$FeeRuleToJson(this);
}
