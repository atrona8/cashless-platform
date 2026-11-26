// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'media2.dart';
import 'wallet_status.dart';

part 'wallet_overview.g.dart';

/// Portefeuille vu du back-office. Montants en unités mineures de `currency`. `customer_ref` est masqué.
///
@JsonSerializable()
class WalletOverview {
  const WalletOverview({
    required this.walletId,
    required this.status,
    required this.eventId,
    required this.currency,
    required this.paidBalance,
    required this.promoBalance,
    required this.deposit,
    required this.media,
    required this.customerRef,
  });

  factory WalletOverview.fromJson(Map<String, Object?> json) =>
      _$WalletOverviewFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final WalletStatus status;
  @JsonKey(name: 'event_id')
  final String eventId;
  final Currency currency;
  @JsonKey(name: 'paid_balance')
  final int paidBalance;
  @JsonKey(name: 'promo_balance')
  final int promoBalance;
  final int deposit;
  final List<Media2> media;

  /// Référence du festivalier, masquée.
  @JsonKey(name: 'customer_ref')
  final String? customerRef;

  Map<String, Object?> toJson() => _$WalletOverviewToJson(this);
}
