// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'balance.dart';
import 'currency.dart';
import 'customer_media.dart';
import 'event2.dart';
import 'refund.dart';
import 'timestamp.dart';
import 'wallet_kyc_level.dart';
import 'wallet_status.dart';

part 'wallet.g.dart';

@JsonSerializable()
class Wallet {
  const Wallet({
    required this.walletId,
    required this.status,
    required this.kycLevel,
    required this.currency,
    required this.event,
    required this.balance,
    required this.balanceAsOf,
    required this.media,
    required this.refund,
    this.pendingOfflineNotice,
  });

  factory Wallet.fromJson(Map<String, Object?> json) => _$WalletFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final WalletStatus status;

  /// Calculé à la lecture (ADR-54) — VERIFIED tant que le client a une identification non révoquée et une pièce non expirée.
  @JsonKey(name: 'kyc_level')
  final WalletKycLevel kycLevel;
  final Currency currency;
  final Event2 event;
  final Balance balance;
  @JsonKey(name: 'balance_as_of')
  final Timestamp balanceAsOf;

  /// Des terminaux hors ligne peuvent encore remonter des achats (solde provisoire).
  @JsonKey(name: 'pending_offline_notice')
  final bool? pendingOfflineNotice;
  final List<CustomerMedia> media;
  final Refund refund;

  Map<String, Object?> toJson() => _$WalletToJson(this);
}
