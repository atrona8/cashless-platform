// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'handover.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Handover _$HandoverFromJson(Map<String, dynamic> json) => Handover(
  handoverId: json['handover_id'] as String,
  direction: $enumDecode(_$HandoverDirectionEnumMap, json['direction']),
  state: $enumDecode(_$HandoverStateEnumMap, json['state']),
  epoch: (json['epoch'] as num).toInt(),
  requestedAt: DateTime.parse(json['requested_at'] as String),
  centralWatermarkPostingId: (json['central_watermark_posting_id'] as num?)
      ?.toInt(),
  finalEdgeSeq: (json['final_edge_seq'] as num?)?.toInt(),
  missingEdgeSeqs: (json['missing_edge_seqs'] as List<dynamic>?)
      ?.map((e) => (e as num).toInt())
      .toList(),
  completedAt: json['completed_at'] == null
      ? null
      : DateTime.parse(json['completed_at'] as String),
);

Map<String, dynamic> _$HandoverToJson(Handover instance) => <String, dynamic>{
  'handover_id': instance.handoverId,
  'direction': instance.direction,
  'state': instance.state,
  'epoch': instance.epoch,
  'central_watermark_posting_id': instance.centralWatermarkPostingId,
  'final_edge_seq': instance.finalEdgeSeq,
  'missing_edge_seqs': instance.missingEdgeSeqs,
  'requested_at': instance.requestedAt.toIso8601String(),
  'completed_at': instance.completedAt?.toIso8601String(),
};

const _$HandoverDirectionEnumMap = {
  HandoverDirection.toEdge: 'TO_EDGE',
  HandoverDirection.toCentral: 'TO_CENTRAL',
};

const _$HandoverStateEnumMap = {
  HandoverState.granted: 'GRANTED',
  HandoverState.active: 'ACTIVE',
  HandoverState.releaseRequested: 'RELEASE_REQUESTED',
  HandoverState.releasing: 'RELEASING',
  HandoverState.completed: 'COMPLETED',
  HandoverState.forced: 'FORCED',
  HandoverState.failed: 'FAILED',
};
