// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'signed_amount.dart';

part 'data.g.dart';

@JsonSerializable()
class Data {
  const Data({
    required this.transactionId,
    required this.occurredAt,
    required this.type,
    required this.amount,
    this.label,
  });

  factory Data.fromJson(Map<String, Object?> json) => _$DataFromJson(json);

  @JsonKey(name: 'transaction_id')
  final String transactionId;
  @JsonKey(name: 'occurred_at')
  final DateTime occurredAt;
  final String type;
  final String? label;
  final SignedAmount amount;

  Map<String, Object?> toJson() => _$DataToJson(this);
}
