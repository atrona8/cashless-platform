// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_activation_request_channel.dart';
import 'money_movement.dart';
import 'tap_input.dart';
import 'timestamp.dart';

part 'media_activation_request.g.dart';

@JsonSerializable()
class MediaActivationRequest {
  const MediaActivationRequest({
    required this.tap,
    required this.channel,
    required this.occurredAt,
    this.tapId,
    this.walletId,
    this.customerId,
    this.depositPayment,
  });

  factory MediaActivationRequest.fromJson(Map<String, Object?> json) =>
      _$MediaActivationRequestFromJson(json);

  /// Lecture du bracelet à activer, embarquée dans la demande. Un bracelet jamais activé n'a pas de `tap_id` :.
  /// `register_tap` répond `NOT_ACTIVATED` sans enregistrer de lecture (§7.6). L'activation porte donc toujours.
  /// sa lecture ; le serveur vérifie que l'UID et la signature d'originalité sont ceux de la personnalisation.
  ///
  final TapInput tap;

  /// Sans effet pour une activation (voir `tap`) ; une demande qui ne porte que `tap_id` est refusée (`422`).
  @JsonKey(name: 'tap_id')
  final int? tapId;

  /// SELF_APP passe par POST /me/media.
  final MediaActivationRequestChannel channel;
  @JsonKey(name: 'wallet_id')
  final String? walletId;
  @JsonKey(name: 'customer_id')
  final String? customerId;
  @JsonKey(name: 'deposit_payment')
  final MoneyMovement? depositPayment;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;

  Map<String, Object?> toJson() => _$MediaActivationRequestToJson(this);
}
