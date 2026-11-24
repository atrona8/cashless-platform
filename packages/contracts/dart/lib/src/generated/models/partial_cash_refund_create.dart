// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tap_input.dart';

part 'partial_cash_refund_create.g.dart';

/// Passage obligatoire, par `tap_id` (passage déjà enregistré) OU `tap` (lecture en ligne), exactement comme.
/// `releaseMedia` ; aucun des deux, ou les deux : `400`.
///
@JsonSerializable()
class PartialCashRefundCreate {
  const PartialCashRefundCreate({required this.amount, this.tapId, this.tap});

  factory PartialCashRefundCreate.fromJson(Map<String, Object?> json) =>
      _$PartialCashRefundCreateFromJson(json);

  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;

  /// Montant débité du solde payé, en unités mineures.
  final int amount;

  Map<String, Object?> toJson() => _$PartialCashRefundCreateToJson(this);
}
