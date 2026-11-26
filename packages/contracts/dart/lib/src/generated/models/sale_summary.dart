// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'sale_summary_channel.dart';
import 'sale_summary_source.dart';
import 'sale_summary_status.dart';
import 'timestamp.dart';

part 'sale_summary.g.dart';

/// Vente (transaction `PURCHASE`). Montant en unités mineures de `currency`. Aucun identifiant de portefeuille.
/// ni donnée du festivalier.
///
@JsonSerializable()
class SaleSummary {
  const SaleSummary({
    required this.transactionId,
    required this.eventId,
    required this.occurredAt,
    required this.amount,
    required this.currency,
    required this.posId,
    required this.merchantId,
    required this.vendorId,
    required this.deviceId,
    required this.source,
    required this.channel,
    required this.status,
    this.reversalTransactionId,
  });

  factory SaleSummary.fromJson(Map<String, Object?> json) =>
      _$SaleSummaryFromJson(json);

  @JsonKey(name: 'transaction_id')
  final String transactionId;
  @JsonKey(name: 'event_id')
  final String eventId;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  final int amount;
  final Currency currency;
  @JsonKey(name: 'pos_id')
  final String? posId;
  @JsonKey(name: 'merchant_id')
  final String? merchantId;
  @JsonKey(name: 'vendor_id')
  final String? vendorId;
  @JsonKey(name: 'device_id')
  final String? deviceId;
  final SaleSummarySource source;
  final SaleSummaryChannel channel;
  final SaleSummaryStatus status;

  /// Annulation de la vente (présente quand `status = REVERSED`).
  @JsonKey(name: 'reversal_transaction_id')
  final String? reversalTransactionId;

  Map<String, Object?> toJson() => _$SaleSummaryToJson(this);
}
