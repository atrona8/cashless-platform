// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'destination4.dart';

part 'refund_request_backoffice_create.g.dart';

/// Demande de remboursement créée par le back-office, directement `REQUESTED`.
@JsonSerializable()
class RefundRequestBackofficeCreate {
  const RefundRequestBackofficeCreate({
    required this.walletId,
    required this.destination,
    required this.reason,
  });

  factory RefundRequestBackofficeCreate.fromJson(Map<String, Object?> json) =>
      _$RefundRequestBackofficeCreateFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;

  /// `msisdn` pour `WAVE` et `ORANGE_MONEY` ; `iban` pour `BANK_TRANSFER` (ISO 13616, modulo 97).
  final Destination4 destination;
  final String reason;

  Map<String, Object?> toJson() => _$RefundRequestBackofficeCreateToJson(this);
}
