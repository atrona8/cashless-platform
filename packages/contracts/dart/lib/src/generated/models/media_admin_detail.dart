// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'deposit_status.dart';
import 'media_admin_batch_kind.dart';
import 'media_admin_kind.dart';
import 'media_batch_status.dart';
import 'media_status.dart';
import 'status_history.dart';
import 'wallets2.dart';

part 'media_admin_detail.g.dart';

@JsonSerializable()
class MediaAdminDetail {
  const MediaAdminDetail({
    required this.mediaId,
    required this.status,
    required this.kind,
    required this.keyIndex,
    required this.depositStatus,
    required this.depositHeld,
    required this.hasClaimCode,
    required this.wallets,
    required this.statusHistory,
    this.personalizedAt,
    this.batchId,
    this.batchKind,
    this.batchStatus,
    this.organizerId,
    this.eventId,
    this.claimCodeUsedAt,
  });

  factory MediaAdminDetail.fromJson(Map<String, Object?> json) =>
      _$MediaAdminDetailFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  final MediaStatus status;
  final MediaAdminKind kind;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  @JsonKey(name: 'personalized_at')
  final DateTime? personalizedAt;
  @JsonKey(name: 'batch_id')
  final String? batchId;
  @JsonKey(name: 'batch_kind')
  final MediaAdminBatchKind? batchKind;
  @JsonKey(name: 'batch_status')
  final MediaBatchStatus? batchStatus;
  @JsonKey(name: 'organizer_id')
  final String? organizerId;
  @JsonKey(name: 'event_id')
  final String? eventId;
  @JsonKey(name: 'deposit_status')
  final DepositStatus depositStatus;

  /// Caution détenue ; 0 = aucune.
  @JsonKey(name: 'deposit_held')
  final int depositHeld;
  @JsonKey(name: 'has_claim_code')
  final bool hasClaimCode;
  @JsonKey(name: 'claim_code_used_at')
  final DateTime? claimCodeUsedAt;
  final List<Wallets2> wallets;
  @JsonKey(name: 'status_history')
  final List<StatusHistory> statusHistory;

  Map<String, Object?> toJson() => _$MediaAdminDetailToJson(this);
}
