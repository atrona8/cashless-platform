// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'money_movement.dart';
import 'tap_input.dart';

part 'deposit_request.g.dart';

@JsonSerializable()
class DepositRequest {
  const DepositRequest({
    this.tapId,
    this.tap,
    this.payment,
    this.cashSessionId,
  });

  factory DepositRequest.fromJson(Map<String, Object?> json) =>
      _$DepositRequestFromJson(json);

  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;
  final MoneyMovement? payment;

  /// Facultatif. Espèces : la session `OPEN` du terminal ; fourni, il DOIT être celle-là (sinon.
  /// `409 CONFLICT_STATE`).
  ///
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$DepositRequestToJson(this);
}
