// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'cash_movement.dart';
import 'tap_input.dart';

part 'media_release_request.g.dart';

/// Espèces uniquement (voir `releaseMedia`).
@JsonSerializable()
class MediaReleaseRequest {
  const MediaReleaseRequest({
    this.tapId,
    this.tap,
    this.cashSessionId,
    this.refundDepositBy,
    this.settleBalance,
  });

  factory MediaReleaseRequest.fromJson(Map<String, Object?> json) =>
      _$MediaReleaseRequestFromJson(json);

  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;

  /// Session de caisse ouverte ; obligatoire si des espèces sont rendues.
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;
  @JsonKey(name: 'refund_deposit_by')
  final CashMovement? refundDepositBy;
  @JsonKey(name: 'settle_balance')
  final CashMovement? settleBalance;

  Map<String, Object?> toJson() => _$MediaReleaseRequestToJson(this);
}
