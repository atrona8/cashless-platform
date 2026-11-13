// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_cash_session_status.dart';
import 'timestamp.dart';

part 'edge_cash_session.g.dart';

/// Session de caisse d'un terminal `TOPUP_DESK`. Usage : `createCashTopup` (`409 CONFLICT_STATE` sans.
/// session `OPEN` du terminal, FR-015), `takeDeposit` en espèces (idem, `cash_session_id` facultatif de la.
/// requête) ; condition 3 de la tolérance du jeton de personne (la personne qui a ouvert la session). Le.
/// contrat public ne connaît que `OPEN` et `CLOSED` (`CashSession.status`) ; ici `CLOSING` existe aussi.
/// (`cash_session.status`) et vaut fermé pour la passerelle. Ni théorique, ni compté, ni écart, ni compte.
/// d'espèces : la passerelle n'en a pas l'usage.
///
@JsonSerializable()
class EdgeCashSession {
  const EdgeCashSession({
    required this.cashSessionId,
    required this.deviceId,
    required this.status,
    required this.openedBy,
    required this.openedAt,
    this.closedAt,
  });

  factory EdgeCashSession.fromJson(Map<String, Object?> json) =>
      _$EdgeCashSessionFromJson(json);

  @JsonKey(name: 'cash_session_id')
  final String cashSessionId;
  @JsonKey(name: 'device_id')
  final String deviceId;
  final EdgeCashSessionStatus status;

  /// Identifiant de la personne (`EdgeStaff.user_id`) qui a ouvert la session.
  @JsonKey(name: 'opened_by')
  final String openedBy;
  @JsonKey(name: 'opened_at')
  final Timestamp openedAt;
  @JsonKey(name: 'closed_at')
  final Timestamp? closedAt;

  Map<String, Object?> toJson() => _$EdgeCashSessionToJson(this);
}
