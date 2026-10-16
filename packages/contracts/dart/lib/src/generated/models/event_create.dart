// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'event_create_activation_modes.dart';
import 'event_create_identity_mode.dart';
import 'event_create_issuer.dart';
import 'event_create_lost_media_policy.dart';
import 'funds_holder.dart';

part 'event_create.g.dart';

/// Création d'un événement. Les réglages omis prennent la valeur par défaut du schéma. Un `operator_id` reçu est.
/// ignoré (prestataire du chemin).
///
@JsonSerializable()
class EventCreate {
  const EventCreate({
    required this.organizerId,
    required this.name,
    required this.currency,
    required this.timezone,
    required this.jurisdictionId,
    required this.fundsHolder,
    this.issuer = EventCreateIssuer.organizer,
    this.startsAt,
    this.endsAt,
    this.refundDeadline,
    this.contractId,
    this.fundsHolderPartyId,
    this.identityMode,
    this.activationModes,
    this.lostMediaPolicy,
    this.cashRefundSingleMax,
    this.reversalWindowMinutes,
  });

  factory EventCreate.fromJson(Map<String, Object?> json) =>
      _$EventCreateFromJson(json);

  @JsonKey(name: 'organizer_id')
  final String organizerId;
  final String name;
  final Currency currency;
  final String timezone;
  @JsonKey(name: 'starts_at')
  final DateTime? startsAt;
  @JsonKey(name: 'ends_at')
  final DateTime? endsAt;
  @JsonKey(name: 'refund_deadline')
  final DateTime? refundDeadline;
  @JsonKey(name: 'jurisdiction_id')
  final String jurisdictionId;
  @JsonKey(name: 'contract_id')
  final String? contractId;
  @JsonKey(name: 'funds_holder')
  final FundsHolder fundsHolder;
  @JsonKey(name: 'funds_holder_party_id')
  final String? fundsHolderPartyId;
  final EventCreateIssuer issuer;
  @JsonKey(name: 'identity_mode')
  final EventCreateIdentityMode? identityMode;
  @JsonKey(name: 'activation_modes')
  final List<EventCreateActivationModes>? activationModes;
  @JsonKey(name: 'lost_media_policy')
  final EventCreateLostMediaPolicy? lostMediaPolicy;
  @JsonKey(name: 'cash_refund_single_max')
  final int? cashRefundSingleMax;
  @JsonKey(name: 'reversal_window_minutes')
  final int? reversalWindowMinutes;

  Map<String, Object?> toJson() => _$EventCreateToJson(this);
}
