// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_operation_status.dart';
import 'shortfall_reason.dart';
import 'offline_reject_reason.dart';

part 'edge_decision.g.dart';

@JsonSerializable()
class EdgeDecision {
  const EdgeDecision({
    required this.status,
    required this.chargedToWallet,
    required this.shortfallAmount,
    this.shortfallReason,
    this.rejectReason,
  });

  factory EdgeDecision.fromJson(Map<String, Object?> json) =>
      _$EdgeDecisionFromJson(json);

  final OfflineOperationStatus status;
  @JsonKey(name: 'charged_to_wallet')
  final int chargedToWallet;
  @JsonKey(name: 'shortfall_amount')
  final int shortfallAmount;
  @JsonKey(name: 'shortfall_reason')
  final ShortfallReason? shortfallReason;
  @JsonKey(name: 'reject_reason')
  final OfflineRejectReason? rejectReason;

  Map<String, Object?> toJson() => _$EdgeDecisionToJson(this);
}
