// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'status_condition_source.dart';

part 'status_condition.g.dart';

/// Condition d'un passage de statut et son état.
@JsonSerializable()
class StatusCondition {
  const StatusCondition({
    required this.code,
    required this.met,
    required this.detail,
    required this.source,
    this.ownerMission,
  });

  factory StatusCondition.fromJson(Map<String, Object?> json) =>
      _$StatusConditionFromJson(json);

  /// Identifiant stable. `DATABASE` : `TRANSITION_ALLOWED`, `DEVICES_CAUGHT_UP`, `DEBIT_AUTHORITY_CENTRAL`,.
  /// `SUSPENSE_ZERO`, `PARTY_POSITIONS_ZERO`, `PAYOUT_PENDING_ZERO`, `POSITIONS_SETTLED`. `CONFIGURATION` :.
  /// `FUNDS_HOLDER_SET`, `CONTRACT_IN_FORCE`, `JURISDICTION_SET`, `LEDGER_OPEN`. `EXTERNAL` :.
  /// `CASH_DESKS_COUNTED`, `PSP_RECONCILED`, `DEVICES_REPORTED`.
  ///
  final String code;

  /// `null` : condition externe, pas encore calculable.
  final bool? met;

  /// Raison, traduite selon `Accept-Language`.
  final String detail;
  final StatusConditionSource source;

  /// Pour une condition `EXTERNAL` - mission qui la rendra calculable.
  @JsonKey(name: 'owner_mission')
  final String? ownerMission;

  Map<String, Object?> toJson() => _$StatusConditionToJson(this);
}
