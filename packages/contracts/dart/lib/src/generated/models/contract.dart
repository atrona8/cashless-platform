// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'contract_cash_diff_bearer.dart';
import 'contract_chargeback_bearer.dart';
import 'contract_kind.dart';
import 'contract_offline_loss_bearer.dart';
import 'contract_operator_fee_basis.dart';
import 'contract_platform_fee_mode.dart';
import 'timestamp.dart';

part 'contract.g.dart';

/// Version d'un contrat (`contract`, §4.3). Jamais modifiée. Champs propres au type : `platform_fee_mode`.
/// (`PLATFORM_OPERATOR`) ; `offline_loss_bearer`, `cash_diff_bearer`, `breakage_organizer_bps`.
/// (`OPERATOR_ORGANIZER`).
///
@JsonSerializable()
class Contract {
  const Contract({
    required this.contractId,
    required this.operatorId,
    required this.kind,
    required this.counterpartyId,
    required this.version,
    required this.validFrom,
    required this.operatorFeeBasis,
    required this.chargebackBearer,
    this.platformFeeMode,
    this.offlineLossBearer,
    this.cashDiffBearer,
    this.breakageOrganizerBps,
  });

  factory Contract.fromJson(Map<String, Object?> json) =>
      _$ContractFromJson(json);

  @JsonKey(name: 'contract_id')
  final String contractId;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  final ContractKind kind;

  /// Plateforme (`PLATFORM_OPERATOR`) ou organisateur (`OPERATOR_ORGANIZER`).
  @JsonKey(name: 'counterparty_id')
  final String counterpartyId;
  final int version;
  @JsonKey(name: 'valid_from')
  final Timestamp validFrom;
  @JsonKey(name: 'platform_fee_mode')
  final ContractPlatformFeeMode? platformFeeMode;
  @JsonKey(name: 'offline_loss_bearer')
  final ContractOfflineLossBearer? offlineLossBearer;
  @JsonKey(name: 'cash_diff_bearer')
  final ContractCashDiffBearer? cashDiffBearer;

  /// Part de la casse de l'organisateur, en points de base ; le reste au prestataire.
  @JsonKey(name: 'breakage_organizer_bps')
  final int? breakageOrganizerBps;
  @JsonKey(name: 'operator_fee_basis')
  final ContractOperatorFeeBasis operatorFeeBasis;
  @JsonKey(name: 'chargeback_bearer')
  final ContractChargebackBearer chargebackBearer;

  Map<String, Object?> toJson() => _$ContractToJson(this);
}
