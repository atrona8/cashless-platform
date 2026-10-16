// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'handover_direction.dart';
import 'handover_state.dart';
import 'timestamp.dart';

part 'handover.g.dart';

@JsonSerializable()
class Handover {
  const Handover({
    required this.handoverId,
    required this.direction,
    required this.state,
    required this.epoch,
    required this.requestedAt,
    this.centralWatermarkPostingId,
    this.finalEdgeSeq,
    this.missingEdgeSeqs,
    this.completedAt,
  });

  factory Handover.fromJson(Map<String, Object?> json) =>
      _$HandoverFromJson(json);

  @JsonKey(name: 'handover_id')
  final String handoverId;
  final HandoverDirection direction;

  /// TO_EDGE : GRANTED → ACTIVE. TO_CENTRAL : RELEASE_REQUESTED → RELEASING → COMPLETED.
  /// `RELEASING` est posé par l'API à la réception de `POST /edge/handovers/{handover_id}/release`,.
  /// avant toute vérification (sync_protocol.md §9.3, étape 5).
  /// FORCED : reprise forcée par le central. FAILED : abandon.
  ///
  final HandoverState state;
  final int epoch;
  @JsonKey(name: 'central_watermark_posting_id')
  final int? centralWatermarkPostingId;
  @JsonKey(name: 'final_edge_seq')
  final int? finalEdgeSeq;
  @JsonKey(name: 'missing_edge_seqs')
  final List<int>? missingEdgeSeqs;
  @JsonKey(name: 'requested_at')
  final Timestamp requestedAt;
  @JsonKey(name: 'completed_at')
  final Timestamp? completedAt;

  Map<String, Object?> toJson() => _$HandoverToJson(this);
}
