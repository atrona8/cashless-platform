// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'deposit_state_mode.dart';
import 'deposit_status.dart';

part 'deposit_state.g.dart';

@JsonSerializable()
class DepositState {
  const DepositState({
    required this.status,
    required this.amount,
    this.mode,
    this.transactionId,
    this.cashSessionId,
  });

  factory DepositState.fromJson(Map<String, Object?> json) =>
      _$DepositStateFromJson(json);

  final DepositStatus status;
  final int amount;
  final DepositStateMode? mode;
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  /// Session de caisse qui a reçu l'écriture (espèces) ; null sinon.
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$DepositStateToJson(this);
}
