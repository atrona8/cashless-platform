// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'contract_version_create_cash_diff_bearer.dart';
import 'contract_version_create_chargeback_bearer.dart';
import 'contract_version_create_offline_loss_bearer.dart';
import 'contract_version_create_operator_fee_basis.dart';
import 'contract_version_create_platform_fee_mode.dart';
import 'timestamp.dart';

part 'contract_version_create.g.dart';

/// Nouvelle version d'un contrat. `valid_from` ne peut pas précéder celle de la version en vigueur. Un champ.
/// omis reprend la valeur de la version précédente ; seuls les champs du type du contrat sont acceptés.
///
@JsonSerializable()
class ContractVersionCreate {
  const ContractVersionCreate({
    required this.validFrom,
    this.platformFeeMode,
    this.offlineLossBearer,
    this.cashDiffBearer,
    this.breakageOrganizerBps,
    this.operatorFeeBasis,
    this.chargebackBearer,
  });

  factory ContractVersionCreate.fromJson(Map<String, Object?> json) =>
      _$ContractVersionCreateFromJson(json);

  @JsonKey(name: 'valid_from')
  final Timestamp validFrom;
  @JsonKey(name: 'platform_fee_mode')
  final ContractVersionCreatePlatformFeeMode? platformFeeMode;
  @JsonKey(name: 'offline_loss_bearer')
  final ContractVersionCreateOfflineLossBearer? offlineLossBearer;
  @JsonKey(name: 'cash_diff_bearer')
  final ContractVersionCreateCashDiffBearer? cashDiffBearer;
  @JsonKey(name: 'breakage_organizer_bps')
  final int? breakageOrganizerBps;
  @JsonKey(name: 'operator_fee_basis')
  final ContractVersionCreateOperatorFeeBasis? operatorFeeBasis;
  @JsonKey(name: 'chargeback_bearer')
  final ContractVersionCreateChargebackBearer? chargebackBearer;

  Map<String, Object?> toJson() => _$ContractVersionCreateToJson(this);
}
