// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'money_movement.dart';
import 'tap_input.dart';

part 'deposit_request.g.dart';

@JsonSerializable()
class DepositRequest {
  const DepositRequest({this.tapId, this.tap, this.payment});

  factory DepositRequest.fromJson(Map<String, Object?> json) =>
      _$DepositRequestFromJson(json);

  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;
  final MoneyMovement? payment;

  Map<String, Object?> toJson() => _$DepositRequestToJson(this);
}
