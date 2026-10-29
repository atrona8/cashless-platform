// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_status.dart';

part 'media_release_response.g.dart';

@JsonSerializable()
class MediaReleaseResponse {
  const MediaReleaseResponse({
    required this.mediaId,
    required this.mediaStatus,
    this.depositRefundTransactionId,
    this.promoExpiryTransactionId,
    this.balanceRefundTransactionId,
    this.cashToHandBack,
    this.cashSessionId,
  });

  factory MediaReleaseResponse.fromJson(Map<String, Object?> json) =>
      _$MediaReleaseResponseFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'media_status')
  final MediaStatus mediaStatus;
  @JsonKey(name: 'deposit_refund_transaction_id')
  final String? depositRefundTransactionId;

  /// Transaction `PROMO_EXPIRY` des crédits offerts restants (null s'il n'y en avait pas).
  @JsonKey(name: 'promo_expiry_transaction_id')
  final String? promoExpiryTransactionId;

  /// Transaction `WALLET_REFUND` du solde payé (null si le solde payé était nul).
  @JsonKey(name: 'balance_refund_transaction_id')
  final String? balanceRefundTransactionId;

  /// Montant total en espèces à remettre au festivalier.
  @JsonKey(name: 'cash_to_hand_back')
  final int? cashToHandBack;

  /// Session de caisse qui a reçu les écritures en espèces ; null si aucune espèce n'a été rendue.
  @JsonKey(name: 'cash_session_id')
  final String? cashSessionId;

  Map<String, Object?> toJson() => _$MediaReleaseResponseToJson(this);
}
