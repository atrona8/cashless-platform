// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'fee_rule_create_basis.dart';
import 'fee_rule_create_trigger.dart';
import 'fee_rule_scope_type.dart';
import 'timestamp.dart';

part 'fee_rule_create.g.dart';

/// Création ou remplacement d'une règle. `valid_from` omise : instant de l'écriture. `min_amount` ne dépasse pas.
/// `max_amount`.
///
@JsonSerializable()
class FeeRuleCreate {
  const FeeRuleCreate({
    required this.scopeType,
    required this.scopeId,
    required this.payerPurpose,
    required this.beneficiaryPurpose,
    required this.basis,
    required this.trigger,
    this.minAmount,
    this.maxAmount,
    this.taxCode,
    this.validFrom,
    this.rateBps = 0,
    this.fixedAmount = 0,
    this.taxInclusive = true,
  });

  factory FeeRuleCreate.fromJson(Map<String, Object?> json) =>
      _$FeeRuleCreateFromJson(json);

  @JsonKey(name: 'scope_type')
  final FeeRuleScopeType scopeType;
  @JsonKey(name: 'scope_id')
  final String scopeId;
  @JsonKey(name: 'payer_purpose')
  final String payerPurpose;
  @JsonKey(name: 'beneficiary_purpose')
  final String beneficiaryPurpose;
  final FeeRuleCreateBasis basis;
  @JsonKey(name: 'rate_bps')
  final int rateBps;
  @JsonKey(name: 'fixed_amount')
  final int fixedAmount;
  @JsonKey(name: 'min_amount')
  final int? minAmount;
  @JsonKey(name: 'max_amount')
  final int? maxAmount;
  @JsonKey(name: 'tax_code')
  final String? taxCode;
  @JsonKey(name: 'tax_inclusive')
  final bool taxInclusive;
  final FeeRuleCreateTrigger trigger;
  @JsonKey(name: 'valid_from')
  final Timestamp? validFrom;

  Map<String, Object?> toJson() => _$FeeRuleCreateToJson(this);
}
