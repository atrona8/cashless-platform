// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tap_input.dart';

part 'cash_due_refund_request.g.dart';

/// Pas de champ montant. Le serveur le calcule (anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes du bracelet).
/// `cash_session_id` est facultatif : le compte crédité est la caisse du terminal, dont la session doit être.
/// `OPEN` (`409 CONFLICT_STATE` sinon) ; fourni, il DOIT être cette session.
///
@JsonSerializable()
class CashDueRefundRequest {
  const CashDueRefundRequest({this.tapId, this.tap, this.cashSessionId});

  factory CashDueRefundRequest.fromJson(Map<String, Object?> json) =>
      _$CashDueRefundRequestFromJson(json);

  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapInput? tap;

  /// Session de caisse ouverte du terminal ; son compte de caisse est crédité.
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$CashDueRefundRequestToJson(this);
}
