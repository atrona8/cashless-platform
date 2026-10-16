// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_batch_header.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineBatchHeader _$OfflineBatchHeaderFromJson(Map<String, dynamic> json) =>
    OfflineBatchHeader(
      batchId: json['batch_id'] as String,
      deviceSerial: json['device_serial'] as String,
      ledgerId: json['ledger_id'] as String,
      authorityEpoch: (json['authority_epoch'] as num).toInt(),
      seqFrom: (json['seq_from'] as num).toInt(),
      seqTo: (json['seq_to'] as num).toInt(),
      count: (json['count'] as num).toInt(),
      createdAt: DateTime.parse(json['created_at'] as String),
      prevChainHash: json['prev_chain_hash'] as String,
      lastChainHash: json['last_chain_hash'] as String,
      deviceTimeAtSend: json['device_time_at_send'] == null
          ? null
          : DateTime.parse(json['device_time_at_send'] as String),
    );

Map<String, dynamic> _$OfflineBatchHeaderToJson(OfflineBatchHeader instance) =>
    <String, dynamic>{
      'batch_id': instance.batchId,
      'device_serial': instance.deviceSerial,
      'ledger_id': instance.ledgerId,
      'authority_epoch': instance.authorityEpoch,
      'seq_from': instance.seqFrom,
      'seq_to': instance.seqTo,
      'count': instance.count,
      'created_at': instance.createdAt.toIso8601String(),
      'device_time_at_send': instance.deviceTimeAtSend?.toIso8601String(),
      'prev_chain_hash': instance.prevChainHash,
      'last_chain_hash': instance.lastChainHash,
    };
