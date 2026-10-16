// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_batch_update_deposit_mode.dart';
import 'media_batch_update_reuse_policy.dart';

part 'media_batch_update.g.dart';

@JsonSerializable()
class MediaBatchUpdate {
  const MediaBatchUpdate({
    this.quantity,
    this.printOrderRef,
    this.preloadPromoAmount,
    this.depositAmount,
    this.depositMode,
    this.reusePolicy,
  });

  factory MediaBatchUpdate.fromJson(Map<String, Object?> json) =>
      _$MediaBatchUpdateFromJson(json);

  final int? quantity;
  @JsonKey(name: 'print_order_ref')
  final String? printOrderRef;

  /// Crédits offerts posés à l'activation ; 0 = aucun.
  @JsonKey(name: 'preload_promo_amount')
  final int? preloadPromoAmount;

  /// Caution par bracelet ; 0 = pas de caution.
  @JsonKey(name: 'deposit_amount')
  final int? depositAmount;
  @JsonKey(name: 'deposit_mode')
  final MediaBatchUpdateDepositMode? depositMode;
  @JsonKey(name: 'reuse_policy')
  final MediaBatchUpdateReusePolicy? reusePolicy;

  Map<String, Object?> toJson() => _$MediaBatchUpdateToJson(this);
}
