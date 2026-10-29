// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'balance.dart';
import 'currency.dart';
import 'deposit_state.dart';
import 'topup_result_status.dart';
import 'topup_result_type.dart';

part 'topup_result.g.dart';

@JsonSerializable()
class TopupResult {
  const TopupResult({
    required this.transactionId,
    required this.idempotencyKey,
    required this.type,
    required this.status,
    required this.amount,
    required this.currency,
    required this.walletId,
    required this.balanceAfter,
    this.cashSessionId,
    this.deposit,
  });

  factory TopupResult.fromJson(Map<String, Object?> json) =>
      _$TopupResultFromJson(json);

  @JsonKey(name: 'transaction_id')
  final String transactionId;
  @JsonKey(name: 'idempotency_key')
  final String idempotencyKey;
  final TopupResultType type;
  final TopupResultStatus status;
  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'wallet_id')
  final String walletId;
  @JsonKey(name: 'balance_after')
  final Balance balanceAfter;

  /// Session de caisse de la recharge (`TOPUP_CASH`) ; null pour une recharge PSP.
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;
  final DepositState? deposit;

  Map<String, Object?> toJson() => _$TopupResultToJson(this);
}
