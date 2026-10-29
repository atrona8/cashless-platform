// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'tap_input.dart';
import 'timestamp.dart';

part 'cash_topup_request.g.dart';

@JsonSerializable()
class CashTopupRequest {
  const CashTopupRequest({
    required this.amount,
    required this.currency,
    required this.occurredAt,
    this.tapId,
    this.tap,
    this.cashTendered,
    this.cashSessionId,
  });

  factory CashTopupRequest.fromJson(Map<String, Object?> json) =>
      _$CashTopupRequestFromJson(json);

  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;

  /// Espèces remises (pour calcul du rendu, informatif).
  @JsonKey(name: 'cash_tendered')
  final int? cashTendered;

  /// Facultatif. Une recharge `TOPUP_CASH` est rattachée à la session `OPEN` du terminal (SPECIFICATION.
  /// §5.3) ; fourni, il DOIT être celle-là (sinon `409 CONFLICT_STATE`).
  ///
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$CashTopupRequestToJson(this);
}
