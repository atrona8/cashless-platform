// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_media_ref_batch_status.dart';
import 'hex32.dart';
import 'media_status.dart';

part 'edge_media_ref.g.dart';

/// Lien entre un bracelet attaché et son identifiant. Usage : la réponse de `createTap` rend le bracelet ;.
/// `takeDeposit` porte `media_id` dans son chemin ; `EdgeSyncOperation.edge_guichet.media_id` est obligatoire.
/// pour `ACTIVATION` et `DEPOSIT_CASH`. `SnapshotEntry` (déjà dans `media`) ne porte ni `media_id`, ni.
/// `wallet_id`, et ne peut pas être modifié : c'est un schéma partagé avec des routes hors `/edge/*`.
///
@JsonSerializable()
class EdgeMediaRef {
  const EdgeMediaRef({
    required this.mediaId,
    required this.tokenHash,
    required this.walletId,
    required this.status,
    this.batchStatus,
  });

  factory EdgeMediaRef.fromJson(Map<String, Object?> json) =>
      _$EdgeMediaRefFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'token_hash')
  final Hex32 tokenHash;

  /// Portefeuille rattaché ; nul pour un bracelet non attaché (voir `unassigned_media`).
  @JsonKey(name: 'wallet_id')
  final String? walletId;

  /// Statut courant du bracelet. Un blocage n'écrit aucun `posting` : le statut vient d'ici (journal.
  /// `change_seq`), et prime sur `media[]` pour le statut et le statut de lot (A03).
  ///
  final MediaStatus status;
  @JsonKey(name: 'batch_status')
  final EdgeMediaRefBatchStatus? batchStatus;

  Map<String, Object?> toJson() => _$EdgeMediaRefToJson(this);
}
