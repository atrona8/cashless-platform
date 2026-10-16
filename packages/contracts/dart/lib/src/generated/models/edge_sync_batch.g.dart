// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_sync_batch.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeSyncBatch _$EdgeSyncBatchFromJson(Map<String, dynamic> json) =>
    EdgeSyncBatch(
      batchId: json['batch_id'] as String,
      edgeGatewayId: json['edge_gateway_id'] as String,
      ledgerId: json['ledger_id'] as String,
      epoch: (json['epoch'] as num).toInt(),
      edgeSeqFrom: (json['edge_seq_from'] as num).toInt(),
      edgeSeqTo: (json['edge_seq_to'] as num).toInt(),
      prevChainHash: json['prev_chain_hash'] as String,
      lastChainHash: json['last_chain_hash'] as String,
      operations: (json['operations'] as List<dynamic>)
          .map((e) => EdgeSyncOperation.fromJson(e as Map<String, dynamic>))
          .toList(),
      signature: json['signature'] as String,
      deviceBatches: (json['device_batches'] as List<dynamic>?)
          ?.map((e) => DeviceBatches.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$EdgeSyncBatchToJson(EdgeSyncBatch instance) =>
    <String, dynamic>{
      'batch_id': instance.batchId,
      'edge_gateway_id': instance.edgeGatewayId,
      'ledger_id': instance.ledgerId,
      'epoch': instance.epoch,
      'edge_seq_from': instance.edgeSeqFrom,
      'edge_seq_to': instance.edgeSeqTo,
      'prev_chain_hash': instance.prevChainHash,
      'last_chain_hash': instance.lastChainHash,
      'operations': instance.operations,
      'device_batches': instance.deviceBatches,
      'signature': instance.signature,
    };
