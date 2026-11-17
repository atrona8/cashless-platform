// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'payout_line_method.dart';

part 'payout_line.g.dart';

/// Un versement du lot. `msisdn` est exigé pour `WAVE` et `ORANGE_MONEY`, `iban` pour `BANK_TRANSFER` (validé.
/// ISO 13616) ; `CASH` n'en porte aucun. Ces destinations ne sont jamais rendues par les lectures.
///
@JsonSerializable()
class PayoutLine {
  const PayoutLine({
    required this.beneficiaryPartyId,
    required this.amount,
    required this.currency,
    required this.method,
    this.msisdn,
    this.iban,
  });

  factory PayoutLine.fromJson(Map<String, Object?> json) =>
      _$PayoutLineFromJson(json);

  @JsonKey(name: 'beneficiary_party_id')
  final String beneficiaryPartyId;
  final Amount amount;
  final Currency currency;
  final PayoutLineMethod method;
  final String? msisdn;
  final String? iban;

  Map<String, Object?> toJson() => _$PayoutLineToJson(this);
}
