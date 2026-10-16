// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'participation_link_type.dart';
import 'participation_pitch_fee_mode.dart';

part 'participation.g.dart';

/// Présence d'un commerçant à un événement (`merchant_participation`, §3.1, §12.1). `INTERNAL` : versements à.
/// l'organisateur ; `EXTERNAL` : au commerçant. La commission est une règle de frais de portée `PARTICIPATION`.
///
@JsonSerializable()
class Participation {
  const Participation({
    required this.participationId,
    required this.operatorId,
    required this.eventId,
    required this.merchantId,
    required this.linkType,
    required this.payoutTo,
    required this.pitchFeeMode,
    required this.pitchFee,
    required this.pitchFeeReference,
    required this.accountId,
  });

  factory Participation.fromJson(Map<String, Object?> json) =>
      _$ParticipationFromJson(json);

  @JsonKey(name: 'participation_id')
  final String participationId;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'event_id')
  final String eventId;
  @JsonKey(name: 'merchant_id')
  final String merchantId;
  @JsonKey(name: 'link_type')
  final ParticipationLinkType linkType;

  /// Bénéficiaire des versements, posé par la base.
  @JsonKey(name: 'payout_to')
  final String payoutTo;
  @JsonKey(name: 'pitch_fee_mode')
  final ParticipationPitchFeeMode pitchFeeMode;

  /// Droit de place, en unités mineures de la devise de l'événement.
  @JsonKey(name: 'pitch_fee')
  final int pitchFee;

  /// Référence du paiement d'avance (`PREPAID`).
  @JsonKey(name: 'pitch_fee_reference')
  final String? pitchFeeReference;

  /// Compte du commerçant dans le grand livre de l'événement (`L-MCH-<id>`).
  @JsonKey(name: 'account_id')
  final String accountId;

  Map<String, Object?> toJson() => _$ParticipationToJson(this);
}
