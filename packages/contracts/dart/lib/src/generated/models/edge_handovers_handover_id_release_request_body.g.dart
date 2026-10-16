// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_handovers_handover_id_release_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeHandoversHandoverIdReleaseRequestBody
_$EdgeHandoversHandoverIdReleaseRequestBodyFromJson(
  Map<String, dynamic> json,
) => EdgeHandoversHandoverIdReleaseRequestBody(
  epoch: (json['epoch'] as num).toInt(),
  finalEdgeSeq: (json['final_edge_seq'] as num).toInt(),
  lastChainHash: json['last_chain_hash'] as String,
  operationsCount: (json['operations_count'] as num).toInt(),
);

Map<String, dynamic> _$EdgeHandoversHandoverIdReleaseRequestBodyToJson(
  EdgeHandoversHandoverIdReleaseRequestBody instance,
) => <String, dynamic>{
  'epoch': instance.epoch,
  'final_edge_seq': instance.finalEdgeSeq,
  'last_chain_hash': instance.lastChainHash,
  'operations_count': instance.operationsCount,
};
