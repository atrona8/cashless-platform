// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'deposit_mode.dart';

part 'deposit_batches.g.dart';

@JsonSerializable()
class DepositBatches {
  const DepositBatches({
    required this.batchId,
    required this.depositAmount,
    required this.depositMode,
  });

  factory DepositBatches.fromJson(Map<String, Object?> json) =>
      _$DepositBatchesFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;

  /// 0 = pas de caution.
  @JsonKey(name: 'deposit_amount')
  final int depositAmount;
  @JsonKey(name: 'deposit_mode')
  final DepositMode? depositMode;

  Map<String, Object?> toJson() => _$DepositBatchesToJson(this);
}
