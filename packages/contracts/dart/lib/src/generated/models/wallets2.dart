// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';

part 'wallets2.g.dart';

@JsonSerializable()
class Wallets2 {
  const Wallets2({
    required this.walletId,
    required this.currency,
    required this.spendable,
    required this.attachedToAccount,
  });

  factory Wallets2.fromJson(Map<String, Object?> json) =>
      _$Wallets2FromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final Currency currency;
  final int spendable;
  @JsonKey(name: 'attached_to_account')
  final bool attachedToAccount;

  Map<String, Object?> toJson() => _$Wallets2ToJson(this);
}
