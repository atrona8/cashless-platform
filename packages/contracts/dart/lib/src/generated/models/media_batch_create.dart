// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_batch_create_deposit_mode.dart';
import 'media_batch_create_key_mode.dart';
import 'media_batch_create_kind.dart';
import 'media_batch_create_reuse_policy.dart';

part 'media_batch_create.g.dart';

@JsonSerializable()
class MediaBatchCreate {
  const MediaBatchCreate({
    required this.organizerId,
    required this.kind,
    required this.quantity,
    required this.keyIndex,
    this.keyMode = MediaBatchCreateKeyMode.shared,
    this.reusePolicy = MediaBatchCreateReusePolicy.singleUse,
    this.eventId,
    this.printOrderRef,
    this.preloadPromoAmount,
    this.depositAmount,
    this.depositMode,
  });

  factory MediaBatchCreate.fromJson(Map<String, Object?> json) =>
      _$MediaBatchCreateFromJson(json);

  @JsonKey(name: 'organizer_id')
  final String organizerId;
  @JsonKey(name: 'event_id')
  final String? eventId;
  final MediaBatchCreateKind kind;
  final int quantity;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  @JsonKey(name: 'key_mode')
  final MediaBatchCreateKeyMode keyMode;
  @JsonKey(name: 'reuse_policy')
  final MediaBatchCreateReusePolicy reusePolicy;
  @JsonKey(name: 'print_order_ref')
  final String? printOrderRef;

  /// Crédits offerts posés à l'activation ; 0 = aucun.
  @JsonKey(name: 'preload_promo_amount')
  final int? preloadPromoAmount;

  /// Caution par bracelet ; 0 = pas de caution.
  @JsonKey(name: 'deposit_amount')
  final int? depositAmount;
  @JsonKey(name: 'deposit_mode')
  final MediaBatchCreateDepositMode? depositMode;

  Map<String, Object?> toJson() => _$MediaBatchCreateToJson(this);
}
