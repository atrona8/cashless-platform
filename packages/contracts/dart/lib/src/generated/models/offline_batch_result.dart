// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_operation_result.dart';
import 'timestamp.dart';

part 'offline_batch_result.g.dart';

@JsonSerializable()
class OfflineBatchResult {
  const OfflineBatchResult({
    required this.batchId,
    required this.processedAt,
    required this.results,
    required this.contiguousAckedSeq,
    required this.missingSeqs,
    required this.serverTime,
    this.abandoned = false,
    this.nextSnapshotVersion,
  });

  factory OfflineBatchResult.fromJson(Map<String, Object?> json) =>
      _$OfflineBatchResultFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;
  @JsonKey(name: 'processed_at')
  final Timestamp processedAt;
  final List<OfflineOperationResult> results;
  @JsonKey(name: 'contiguous_acked_seq')
  final int contiguousAckedSeq;
  @JsonKey(name: 'missing_seqs')
  final List<int> missingSeqs;
  @JsonKey(name: 'next_snapshot_version')
  final int? nextSnapshotVersion;

  /// Vrai si le lot a été abandonné (traitement interrompu plus de 15 min) : `results` ne contient que les.
  /// opérations traitées ; renvoyer les autres dans un nouveau lot (sync_protocol.md §6.2-6).
  ///
  final bool abandoned;
  @JsonKey(name: 'server_time')
  final Timestamp serverTime;

  Map<String, Object?> toJson() => _$OfflineBatchResultToJson(this);
}
