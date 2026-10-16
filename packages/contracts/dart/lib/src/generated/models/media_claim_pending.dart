// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_claim_pending_status.dart';
import 'timestamp.dart';

part 'media_claim_pending.g.dart';

/// Demande de rattachement en attente de confirmation au guichet (ADR-57).
@JsonSerializable()
class MediaClaimPending {
  const MediaClaimPending({
    required this.claimId,
    required this.status,
    required this.confirmationCode,
    required this.expiresAt,
  });

  factory MediaClaimPending.fromJson(Map<String, Object?> json) =>
      _$MediaClaimPendingFromJson(json);

  @JsonKey(name: 'claim_id')
  final String claimId;
  final MediaClaimPendingStatus status;

  /// À montrer à l'agent du guichet ; n'est renvoyé qu'au compte demandeur.
  @JsonKey(name: 'confirmation_code')
  final String confirmationCode;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;

  Map<String, Object?> toJson() => _$MediaClaimPendingToJson(this);
}
