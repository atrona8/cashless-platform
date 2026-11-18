// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';

part 'late_adjustment_request.g.dart';

/// Apport d'un bénéficiaire de la casse après une réclamation tardive (action `ADJUSTMENT`).
@JsonSerializable()
class LateAdjustmentRequest {
  const LateAdjustmentRequest({
    required this.beneficiaryPartyId,
    required this.amount,
    required this.currency,
    required this.reason,
  });

  factory LateAdjustmentRequest.fromJson(Map<String, Object?> json) =>
      _$LateAdjustmentRequestFromJson(json);

  @JsonKey(name: 'beneficiary_party_id')
  final String beneficiaryPartyId;
  final Amount amount;
  final Currency currency;
  final String reason;

  Map<String, Object?> toJson() => _$LateAdjustmentRequestToJson(this);
}
