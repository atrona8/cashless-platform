// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_batch_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineBatchResult _$OfflineBatchResultFromJson(Map<String, dynamic> json) =>
    OfflineBatchResult(
      batchId: json['batch_id'] as String,
      processedAt: DateTime.parse(json['processed_at'] as String),
      results: (json['results'] as List<dynamic>)
          .map(
            (e) => OfflineOperationResult.fromJson(e as Map<String, dynamic>),
          )
          .toList(),
      contiguousAckedSeq: (json['contiguous_acked_seq'] as num).toInt(),
      missingSeqs: (json['missing_seqs'] as List<dynamic>)
          .map((e) => (e as num).toInt())
          .toList(),
      serverTime: DateTime.parse(json['server_time'] as String),
      abandoned: json['abandoned'] as bool? ?? false,
      nextSnapshotVersion: (json['next_snapshot_version'] as num?)?.toInt(),
    );

Map<String, dynamic> _$OfflineBatchResultToJson(OfflineBatchResult instance) =>
    <String, dynamic>{
      'batch_id': instance.batchId,
      'processed_at': instance.processedAt.toIso8601String(),
      'results': instance.results,
      'contiguous_acked_seq': instance.contiguousAckedSeq,
      'missing_seqs': instance.missingSeqs,
      'next_snapshot_version': instance.nextSnapshotVersion,
      'abandoned': instance.abandoned,
      'server_time': instance.serverTime.toIso8601String(),
    };
