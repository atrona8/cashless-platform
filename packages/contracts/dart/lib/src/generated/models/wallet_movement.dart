// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'signed_amount.dart';
import 'timestamp.dart';
import 'transaction_source.dart';
import 'transaction_type.dart';

part 'wallet_movement.g.dart';

@JsonSerializable()
class WalletMovement {
  const WalletMovement({
    required this.transactionId,
    required this.type,
    required this.source,
    required this.occurredAt,
    required this.amount,
    required this.currency,
    required this.label,
    this.reversesId,
    this.reversedById,
  });

  factory WalletMovement.fromJson(Map<String, Object?> json) =>
      _$WalletMovementFromJson(json);

  @JsonKey(name: 'transaction_id')
  final String transactionId;
  final TransactionType type;
  final TransactionSource source;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  final SignedAmount amount;
  final Currency currency;
  final String label;
  @JsonKey(name: 'reverses_id')
  final String? reversesId;
  @JsonKey(name: 'reversed_by_id')
  final String? reversedById;

  Map<String, Object?> toJson() => _$WalletMovementToJson(this);
}
