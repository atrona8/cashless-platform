// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'channel2.dart';

part 'edge_guichet.g.dart';

@JsonSerializable()
class EdgeGuichet {
  const EdgeGuichet({
    required this.mediaId,
    this.walletId,
    this.eventId,
    this.channel,
    this.depositAmount,
    this.cashDeskAccountId,
  });

  factory EdgeGuichet.fromJson(Map<String, Object?> json) =>
      _$EdgeGuichetFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;

  /// ACTIVATION — portefeuille rattaché (créé par la passerelle s'il est anonyme).
  @JsonKey(name: 'wallet_id')
  final String? walletId;
  @JsonKey(name: 'event_id')
  final String? eventId;
  final Channel2? channel;

  /// DEPOSIT_CASH — montant de la caution encaissée en espèces.
  @JsonKey(name: 'deposit_amount')
  final int? depositAmount;
  @JsonKey(name: 'cash_desk_account_id')
  final String? cashDeskAccountId;

  Map<String, Object?> toJson() => _$EdgeGuichetToJson(this);
}
