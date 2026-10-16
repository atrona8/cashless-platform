// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'destination2.dart';

part 'refund_request_create.g.dart';

@JsonSerializable()
class RefundRequestCreate {
  const RefundRequestCreate({
    required this.walletId,
    required this.destination,
  });

  factory RefundRequestCreate.fromJson(Map<String, Object?> json) =>
      _$RefundRequestCreateFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;

  /// Canaux de remboursement (ADR-53) : `WAVE` et `ORANGE_MONEY` vers le numéro vérifié du titulaire, ou un.
  /// autre numéro avec `new_number_otp` (ADR-76) ;.
  /// `BANK_TRANSFER` (avec `iban`) réservé aux demandes créées par le back-office. Le remboursement par carte.
  /// n'existe pas en V1. Le remboursement en espèces se fait au guichet (pas de demande).
  ///
  final Destination2 destination;

  Map<String, Object?> toJson() => _$RefundRequestCreateToJson(this);
}
