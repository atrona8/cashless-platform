// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'wallet_status.dart';

part 'wallets.g.dart';

@JsonSerializable()
class Wallets {
  const Wallets({
    required this.walletId,
    required this.status,
    required this.paid,
    required this.promo,
  });

  factory Wallets.fromJson(Map<String, Object?> json) =>
      _$WalletsFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final WalletStatus status;
  final int paid;
  final int promo;

  Map<String, Object?> toJson() => _$WalletsToJson(this);
}
