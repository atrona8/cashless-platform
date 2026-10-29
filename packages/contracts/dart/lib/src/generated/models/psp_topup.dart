// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'psp_provider.dart';
import 'psp_topup_status.dart';
import 'timestamp.dart';

part 'psp_topup.g.dart';

@JsonSerializable()
class PspTopup {
  const PspTopup({
    required this.topupId,
    required this.status,
    required this.provider,
    required this.amount,
    required this.currency,
    required this.walletId,
    this.pspConfigId,
    this.providerReference,
    this.checkoutUrl,
    this.expiresAt,
    this.transactionId,
    this.failureReason,
  });

  factory PspTopup.fromJson(Map<String, Object?> json) =>
      _$PspTopupFromJson(json);

  @JsonKey(name: 'topup_id')
  final String topupId;
  final PspTopupStatus status;
  final PspProvider provider;

  /// Configuration PSP (S26) utilisée ; son URL de webhook est `/webhooks/{provider}/{psp_config_id}`.
  @JsonKey(name: 'psp_config_id')
  final String? pspConfigId;
  @JsonKey(name: 'provider_reference')
  final String? providerReference;
  final Amount amount;
  final Currency currency;
  @JsonKey(name: 'wallet_id')
  final String walletId;
  @JsonKey(name: 'checkout_url')
  final String? checkoutUrl;
  @JsonKey(name: 'expires_at')
  final Timestamp? expiresAt;
  @JsonKey(name: 'transaction_id')
  final String? transactionId;

  /// Motif de l'échec, chaîne libre (l'ensemble fermé est arrêté par la livraison de la recharge PSP).
  /// Valeurs indicatives : `THREE_DS`, `NO_FINGERPRINT`, `CARD_DAILY_LIMIT`, `LEDGER_STATUS`, `CANCELLED`.
  ///
  @JsonKey(name: 'failure_reason')
  final String? failureReason;

  Map<String, Object?> toJson() => _$PspTopupToJson(this);
}
