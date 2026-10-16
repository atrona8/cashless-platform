// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_batch_deposit_mode.dart';
import 'media_batch_key_mode.dart';
import 'media_batch_kind.dart';
import 'media_batch_reuse_policy.dart';
import 'media_batch_status.dart';
import 'timestamp.dart';

part 'media_batch.g.dart';

@JsonSerializable()
class MediaBatch {
  const MediaBatch({
    required this.batchId,
    required this.operatorId,
    required this.organizerId,
    required this.kind,
    required this.quantity,
    required this.keyIndex,
    required this.keyMode,
    required this.reusePolicy,
    required this.status,
    required this.preloadPromoAmount,
    required this.depositAmount,
    required this.claimCodesIssued,
    required this.createdAt,
    this.eventId,
    this.printOrderRef,
    this.depositMode,
  });

  factory MediaBatch.fromJson(Map<String, Object?> json) =>
      _$MediaBatchFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'organizer_id')
  final String organizerId;

  /// Événement auquel le lot est réservé ; `null` = valable pour tous les événements de l'organisateur.
  @JsonKey(name: 'event_id')
  final String? eventId;
  final MediaBatchKind kind;
  final int quantity;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  @JsonKey(name: 'key_mode')
  final MediaBatchKeyMode keyMode;
  @JsonKey(name: 'reuse_policy')
  final MediaBatchReusePolicy reusePolicy;
  @JsonKey(name: 'print_order_ref')
  final String? printOrderRef;
  final MediaBatchStatus status;

  /// Crédits offerts posés à l'activation ; 0 = aucun.
  @JsonKey(name: 'preload_promo_amount')
  final int preloadPromoAmount;

  /// Caution par bracelet ; 0 = pas de caution.
  @JsonKey(name: 'deposit_amount')
  final int depositAmount;
  @JsonKey(name: 'deposit_mode')
  final MediaBatchDepositMode? depositMode;

  /// Le fichier de commande des codes de rattachement a déjà été produit.
  @JsonKey(name: 'claim_codes_issued')
  final bool claimCodesIssued;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;

  Map<String, Object?> toJson() => _$MediaBatchToJson(this);
}
