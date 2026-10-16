// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';
import 'transaction_type.dart';
import 'signed_amount.dart';

part 'recent.g.dart';

@JsonSerializable()
class Recent {
  const Recent({
    required this.occurredAt,
    required this.type,
    required this.amount,
  });

  factory Recent.fromJson(Map<String, Object?> json) => _$RecentFromJson(json);

  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  final TransactionType type;
  final SignedAmount amount;

  Map<String, Object?> toJson() => _$RecentToJson(this);
}
