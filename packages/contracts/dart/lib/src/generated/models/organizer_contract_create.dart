// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'organizer_contract_create_cash_diff_bearer.dart';
import 'organizer_contract_create_chargeback_bearer.dart';
import 'organizer_contract_create_offline_loss_bearer.dart';
import 'organizer_contract_create_operator_fee_basis.dart';
import 'timestamp.dart';

part 'organizer_contract_create.g.dart';

@JsonSerializable()
class OrganizerContractCreate {
  const OrganizerContractCreate({
    required this.validFrom,
    required this.offlineLossBearer,
    required this.cashDiffBearer,
    required this.breakageOrganizerBps,
    this.operatorFeeBasis = OrganizerContractCreateOperatorFeeBasis.gross,
    this.chargebackBearer = OrganizerContractCreateChargebackBearer.organizer,
  });

  factory OrganizerContractCreate.fromJson(Map<String, Object?> json) =>
      _$OrganizerContractCreateFromJson(json);

  @JsonKey(name: 'valid_from')
  final Timestamp validFrom;
  @JsonKey(name: 'offline_loss_bearer')
  final OrganizerContractCreateOfflineLossBearer offlineLossBearer;
  @JsonKey(name: 'cash_diff_bearer')
  final OrganizerContractCreateCashDiffBearer cashDiffBearer;
  @JsonKey(name: 'breakage_organizer_bps')
  final int breakageOrganizerBps;
  @JsonKey(name: 'operator_fee_basis')
  final OrganizerContractCreateOperatorFeeBasis operatorFeeBasis;
  @JsonKey(name: 'chargeback_bearer')
  final OrganizerContractCreateChargebackBearer chargebackBearer;

  Map<String, Object?> toJson() => _$OrganizerContractCreateToJson(this);
}
